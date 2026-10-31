// Finding the original of a cropped, mirrored or rotated copy, and lining it
// up so the tamper heatmap compares the right pixels.
//
// The basic pipeline (verify.ts) hashes the WHOLE image, so it only finds
// originals of copies that keep the whole frame. Measured before this module:
// an 8% crop per side was matched 13% of the time, a mirror image 0%. Two
// additions fix that:
//
//   1. VARIANT FINGERPRINTS  For every sealed photo the server also stores the
//      perceptual hashes of its mirror image, its 90/180/270° rotations, and a
//      grid of crops (2 shapes × 4 sizes × 25 positions, each also mirrored).
//      A cropped or flipped copy now lands close to one of them, so it gets
//      SHORTLISTED. (Off-chain only, in the SQLite cache: they are recomputed
//      from the stored original, so nothing extra is written to the chain.)
//
//   2. ALIGNMENT  The shortlist entry only says roughly where the copy came
//      from. alignCrop() then finds the exact crop rectangle: a coarse-to-fine
//      search over size and position, scoring each candidate rectangle by how
//      well a small brightness-normalised thumbnail of it matches the copy.
//      A summed-area table makes every candidate rectangle O(1) per thumbnail
//      pixel, so thousands of candidates take milliseconds.
//
// The pixel diff still DECIDES (NOT_A_DERIVATIVE_PERCENT), exactly as before:
// alignment only makes sure a genuine crop is compared against the matching
// region instead of the whole original. compareDerivative() also runs the
// plain whole-image diff and keeps whichever explains the copy with less
// change, so nothing that matched before can get worse.
import "server-only";
import sharp from "sharp";
import { toBytes } from "../crypto/encoding";
import { computePHash, phashWords, wordDistance, type RgbaImage } from "../crypto/phash";
import { compareImages, type DiffResult } from "./diff";
import { MAX_INPUT_PIXELS } from "./decode-node";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Rotation = 0 | 90 | 180 | 270;
/** How the original was turned: rotate clockwise first, then (optionally) mirror left-right. */
export type Orient = { rot: Rotation; mirror: boolean };
/** A crop rectangle in fractions (0–1) of the ORIENTED original. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Variant = { orient: Orient; rect: Rect };

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const UPRIGHT: Orient = { rot: 0, mirror: false };

/** Long side of the small copy the variants and the alignment work on. */
const WORK = 256;

/** Every variant fingerprinted at registration (see the header). */
export function variantPlan(aspect: number): Variant[] {
  const plan: Variant[] = [];
  for (const rot of [0, 90, 180, 270] as const) {
    for (const mirror of [false, true]) {
      if (rot === 0 && !mirror) continue; // the plain hash is the record's own pHash
      plan.push({ orient: { rot, mirror }, rect: FULL });
    }
  }
  // Crops: the photo's own shape and a square (the "Instagram crop"), four
  // sizes, 5 × 5 positions, plain and mirrored. A perceptual hash moves a lot
  // when the framing shifts by a few percent, so the grid has to be dense.
  for (const shape of [aspect, 1]) {
    for (const size of [0.86, 0.72, 0.58, 0.45]) {
      // Largest rectangle of this shape that fits, then scaled.
      const fitW = shape >= aspect ? 1 : shape / aspect;
      const fitH = shape >= aspect ? aspect / shape : 1;
      const w = fitW * size;
      const h = fitH * size;
      for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
        for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
          const rect = { x: (1 - w) * fx, y: (1 - h) * fy, w, h };
          for (const mirror of [false, true]) plan.push({ orient: { rot: 0, mirror }, rect });
        }
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Pixel helpers (pure)
// ---------------------------------------------------------------------------

type Gray = { width: number; height: number; data: Float32Array };

function rgbaToGray(img: RgbaImage): Gray {
  const data = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
  }
  return { width: img.width, height: img.height, data };
}

/** Summed-area table: sum of any rectangle in 4 lookups. (w+1)×(h+1). */
function integral(g: Gray): Float64Array {
  const W = g.width + 1;
  const sat = new Float64Array(W * (g.height + 1));
  for (let y = 0; y < g.height; y++) {
    let row = 0;
    for (let x = 0; x < g.width; x++) {
      row += g.data[y * g.width + x];
      sat[(y + 1) * W + (x + 1)] = sat[y * W + (x + 1)] + row;
    }
  }
  return sat;
}

/**
 * A tw × th thumbnail of a pixel rectangle (box-averaged through the
 * summed-area table), normalised to zero mean and unit variance, so a
 * brightness or contrast filter on the copy doesn't affect the comparison.
 */
function thumbOf(sat: Float64Array, W: number, px: Rect, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  let sum = 0;
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(px.y + (ty * px.h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(px.y + ((ty + 1) * px.h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(px.x + (tx * px.w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(px.x + ((tx + 1) * px.w) / tw));
      const s = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      const v = s / ((x1 - x0) * (y1 - y0));
      out[ty * tw + tx] = v;
      sum += v;
    }
  }
  const mean = sum / out.length;
  let sq = 0;
  for (let i = 0; i < out.length; i++) sq += (out[i] - mean) ** 2;
  const sd = Math.sqrt(sq / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
  return out;
}

/**
 * Mean absolute difference over the best-matching 70% of thumbnail pixels.
 * Ignoring the worst 30% keeps the alignment robust to the EDIT itself (a
 * pasted object or caption inside a crop), while an unrelated photo still
 * differs almost everywhere. A 64-bin histogram finds the cut-off in O(n).
 */
const KEEP = 0.7;
const BINS = 64;
const BIN_MAX = 4; // |z-score difference| above this lands in the last bin
function trimmedDiff(a: Float32Array, b: Float32Array, keep = KEEP): number {
  const count = new Uint16Array(BINS);
  const sum = new Float64Array(BINS);
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    const bin = Math.min(BINS - 1, Math.floor((d / BIN_MAX) * BINS));
    count[bin]++;
    sum[bin] += d;
  }
  let need = Math.ceil(a.length * keep);
  let total = 0;
  for (let bin = 0; bin < BINS && need > 0; bin++) {
    const take = Math.min(need, count[bin]);
    if (take) total += (sum[bin] / count[bin]) * take;
    need -= take;
  }
  return total / Math.ceil(a.length * keep);
}

// ---------------------------------------------------------------------------
// Decoding with orientation (sharp)
// ---------------------------------------------------------------------------

/** EXIF-upright bytes, then rotated/mirrored as `orient` says, optionally downscaled. */
function oriented(bytes: Uint8Array, orient: Orient, longSide?: number) {
  let img = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient();
  if (orient.rot) img = img.rotate(orient.rot);
  if (orient.mirror) img = img.flop();
  if (longSide) img = img.resize(longSide, longSide, { fit: "inside" });
  return img;
}

async function rgbaOf(img: ReturnType<typeof sharp>): Promise<RgbaImage> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/** Crops a fractional rectangle out of an RGBA image (pure, for the variant hashes). */
function cropRgba(img: RgbaImage, r: Rect): RgbaImage {
  const x0 = Math.round(r.x * img.width);
  const y0 = Math.round(r.y * img.height);
  const w = Math.max(32, Math.min(img.width - x0, Math.round(r.w * img.width)));
  const h = Math.max(32, Math.min(img.height - y0, Math.round(r.h * img.height)));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

// ---------------------------------------------------------------------------
// 1. Variant fingerprints
// ---------------------------------------------------------------------------

export type VariantHash = Variant & { pHash: string };

/** The perceptual hashes of every variant of a sealed photo (~125 ms for a 12 MP photo). */
export async function computeVariants(originalBytes: ArrayBuffer | ArrayBufferView): Promise<VariantHash[]> {
  const bytes = toBytes(originalBytes);
  const out: VariantHash[] = [];
  const byOrient = new Map<string, RgbaImage>();
  const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient().metadata();
  const aspect = (meta.autoOrient?.width ?? meta.width!) / (meta.autoOrient?.height ?? meta.height!);
  for (const v of variantPlan(aspect)) {
    const key = `${v.orient.rot}/${v.orient.mirror}`;
    if (!byOrient.has(key)) byOrient.set(key, await rgbaOf(oriented(bytes, v.orient, WORK)));
    const img = byOrient.get(key)!;
    out.push({ ...v, pHash: computePHash(v.rect === FULL ? img : cropRgba(img, v.rect)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shortlist (pure, shared by the server index and the benchmark)
// ---------------------------------------------------------------------------

export type IndexedVariant = { sha256: string; words: [number, number]; variant: Variant };

/**
 * Sealed photos whose plain hash OR any variant hash is within `maxDistance`
 * of the query, closest first, at most `limit` photos (each with the variant
 * that matched best).
 */
export function shortlist(
  queryPHash: string,
  entries: Iterable<IndexedVariant>,
  maxDistance: number,
  limit = 3,
): { sha256: string; distance: number; variant: Variant }[] {
  const q = phashWords(queryPHash);
  const best = new Map<string, { sha256: string; distance: number; variant: Variant }>();
  for (const e of entries) {
    const d = wordDistance(q, e.words);
    if (d > maxDistance) continue;
    const prev = best.get(e.sha256);
    if (!prev || d < prev.distance) best.set(e.sha256, { sha256: e.sha256, distance: d, variant: e.variant });
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 2. Alignment
// ---------------------------------------------------------------------------

const THUMB = 40;

/**
 * The most an aligned region may differ from the copy (alignCrop's score) for
 * the alignment to be trusted. Measured with `npm run benchmark`: genuine
 * crops, mirrors and rotations score 0.002–0.05, crops WITH a pasted object
 * up to ~0.26, while the best region of a WRONG photo scored 0.30 or more.
 * Above this, the aligned comparison is discarded, so a lucky crop of another
 * photo can never be reported as this copy's original. When in doubt, a miss
 * (UNVERIFIED) is preferred over linking the wrong original.
 */
export const ALIGN_MAX = 0.27;

/**
 * Shortlisting distance for crop/rotation/mirror fingerprints. Wider than the
 * plain PHASH_MATCH_THRESHOLD (16) because a crop rarely lines up exactly with
 * one of the stored crops; safe because anything shortlisted this way must
 * pass the alignment gate above, which is what actually rejects wrong photos.
 */
export const VARIANT_SHORTLIST = 22;

/**
 * A copy must keep at least this share of the original's area to be linked
 * to it (25%: e.g. a crop of 50% × 50%). Measured: every genuine crop in the
 * benchmark kept 36% or more, while every WRONG photo the alignment latched
 * onto matched only a small patch (8–17%) of it. A smaller fragment simply
 * carries too little of the picture to prove where it came from.
 */
export const MIN_KEPT = 0.25;
/**
 * The final gate on an aligned match: detailScore (96 px, best half of the
 * pixels, after fine-tuning) must be at most this. Measured with
 * `npm run benchmark`: every genuine crop, mirror and rotation scored below
 * 0.12; the closest WRONG photo scored 0.151. A few genuine "crop + pasted
 * object" copies score 0.14–0.18 and are deliberately given up (UNVERIFIED)
 * rather than risk linking a copy to the wrong original.
 */
export const DETAIL_MAX = 0.13;
/** The alignment never searches regions smaller than this (side, as a fraction). */
const MIN_SIDE = 0.5;

/**
 * Where inside the (already oriented) original does `query` come from? Returns
 * the best crop rectangle in fractions, and its mismatch score (mean absolute
 * difference of normalised thumbnails: ~0.1 for the right region, ~0.8+ for an
 * unrelated one).
 */
export function alignCrop(original: Gray, query: Gray): { rect: Rect; score: number } {
  const aq = query.width / query.height;
  const tw = aq >= 1 ? THUMB : Math.max(12, Math.round(THUMB * aq));
  const th = aq >= 1 ? Math.max(12, Math.round(THUMB / aq)) : THUMB;
  const qSat = integral(query);
  const target = thumbOf(qSat, query.width + 1, { x: 0, y: 0, w: query.width, h: query.height }, tw, th);

  const oSat = integral(original);
  const W = original.width;
  const H = original.height;
  const maxW = Math.min(W, H * aq);

  const score = (cx: number, cy: number, s: number): { rect: Rect; score: number } | null => {
    const w = maxW * s;
    const h = w / aq;
    if (w < 16 || h < 16) return null;
    const x = Math.min(Math.max(cx - w / 2, 0), W - w);
    const y = Math.min(Math.max(cy - h / 2, 0), H - h);
    const px = { x, y, w, h };
    return { rect: { x: x / W, y: y / H, w: w / W, h: h / H }, score: trimmedDiff(thumbOf(oSat, W + 1, px, tw, th), target) };
  };

  type Candidate = { rect: Rect; score: number; cx: number; cy: number; s: number };

  // Coarse: 14 sizes (100% down to MIN_SIDE of the largest fit) × 13 × 13 centres.
  let coarse: Candidate | null = null;
  for (let i = 0; i < 14; i++) {
    const s = Math.pow(MIN_SIDE, i / 13);
    const w = maxW * s;
    const h = w / aq;
    for (let iy = 0; iy < 13; iy++) {
      const cy = h / 2 + ((H - h) * iy) / 12;
      for (let ix = 0; ix < 13; ix++) {
        const cx = w / 2 + ((W - w) * ix) / 12;
        const r = score(cx, cy, s);
        if (r && (!coarse || r.score < coarse.score)) coarse = { ...r, cx, cy, s };
      }
    }
  }
  if (!coarse) return { rect: FULL, score: Infinity };

  // Fine: shrink the step around the best candidate, four rounds.
  let best: Candidate = coarse;
  let stepS = 0.05;
  let stepXY = Math.max(W, H) / 16;
  for (let round = 0; round < 4; round++) {
    const centre: Candidate = best;
    for (const ds of [-stepS, 0, stepS]) {
      for (const dy of [-stepXY, 0, stepXY]) {
        for (const dx of [-stepXY, 0, stepXY]) {
          const ns = Math.min(1, Math.max(MIN_SIDE, centre.s * (1 + ds)));
          const r = score(centre.cx + dx, centre.cy + dy, ns);
          if (r && r.score < best.score) best = { ...r, cx: centre.cx + dx, cy: centre.cy + dy, s: ns };
        }
      }
    }
    stepS /= 2;
    stepXY /= 2;
  }
  return { rect: best.rect, score: best.score };
}

/**
 * A second, finer look at the chosen region: a 96-px thumbnail, judged on its
 * best-matching HALF of the pixels. A genuine copy matches almost perfectly
 * outside whatever was edited (a pasted object, a caption), so its best half
 * is near-identical; a wrong photo that happened to resemble the copy as a
 * 40-px blob is mediocre everywhere, so even its best half differs.
 */
export function detailScore(original: Gray, query: Gray, rect: Rect): { rect: Rect; score: number } {
  const aq = query.width / query.height;
  const tw = aq >= 1 ? 96 : Math.max(24, Math.round(96 * aq));
  const th = aq >= 1 ? Math.max(24, Math.round(96 / aq)) : 96;
  const W = original.width;
  const H = original.height;
  const oSat = integral(original);
  const target = thumbOf(integral(query), query.width + 1, { x: 0, y: 0, w: query.width, h: query.height }, tw, th);
  const at = (r: Rect) => trimmedDiff(thumbOf(oSat, W + 1, { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H }, tw, th), target, 0.5);

  // Fine-tune the coarse rectangle at this resolution: nudge position and size
  // by shrinking steps (a pasted object can pull the 40-px search slightly off).
  let best = { rect, score: at(rect) };
  let step = 0.02;
  for (let round = 0; round < 5; round++) {
    const c = best.rect;
    for (const ds of [-step, 0, step]) {
      for (const dy of [-step, 0, step]) {
        for (const dx of [-step, 0, step]) {
          const k = 1 + ds;
          const w = c.w * k;
          const h = c.h * k;
          if (w > 1 || h > 1 || w * h < MIN_KEPT) continue;
          const x = Math.min(Math.max(c.x + dx + (c.w - w) / 2, 0), 1 - w);
          const y = Math.min(Math.max(c.y + dy + (c.h - h) / 2, 0), 1 - h);
          const r = { x, y, w, h };
          const sc = at(r);
          if (sc < best.score) best = { rect: r, score: sc };
        }
      }
    }
    step /= 2;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 3. Compare a copy with its (oriented, aligned) original
// ---------------------------------------------------------------------------

export type Geometry = {
  /** Where the copy sits in the original, after undoing rotation/mirroring (fractions). */
  rect: Rect;
  rotation: Rotation;
  mirrored: boolean;
  cropped: boolean;
  keptPercent: number;
  /** How well the copy's thumbnail matched the chosen region (0 = identical; see alignCrop). */
  alignScore: number;
  /** The same at finer detail (96 px, see detailScore). */
  detailScore: number;
};
export type DerivativeDiff = DiffResult & { geometry: Geometry };

const grayOf = async (img: ReturnType<typeof sharp>): Promise<Gray> => rgbaToGray(await rgbaOf(img));

/**
 * The pixel diff between a copy and its original, after undoing the
 * orientation the shortlist suggested and cropping the original to where the
 * copy came from.
 *
 * Two explanations compete, each only when it has earned the right:
 *   plain    the whole-image diff, exactly as before this module. Only allowed
 *            when the copy's own fingerprint matched the original's
 *            (`plainAllowed`), the original pipeline's rule.
 *   aligned  the diff against the aligned region. Only allowed when the
 *            alignment is trustworthy (score ≤ ALIGN_MAX).
 * The one that explains the copy with LESS change wins. Returns null when
 * neither is allowed, i.e. the candidate is not this copy's original.
 */
export async function compareDerivative(
  originalBytes: ArrayBuffer | ArrayBufferView,
  queryBytes: ArrayBuffer | ArrayBufferView,
  orient: Orient,
  plainAllowed: boolean,
): Promise<DerivativeDiff | null> {
  const original = toBytes(originalBytes);
  const query = toBytes(queryBytes);

  const plain = plainAllowed
    ? { ...(await compareImages(original, query)), geometry: { rect: FULL, rotation: 0, mirrored: false, cropped: false, keptPercent: 100, alignScore: 0, detailScore: 0 } as Geometry }
    : null;

  // Align the query inside the oriented original (small copies are plenty).
  // The shortlisted variant's mirror state is only a hint (a symmetric scene
  // can match its own mirror image), so both are tried and the better kept.
  const q = await grayOf(oriented(query, UPRIGHT, WORK));
  let rect: Rect = FULL;
  let score = Infinity;
  let og: Gray | null = null;
  for (const o of [orient, { rot: orient.rot, mirror: !orient.mirror }]) {
    const g = await grayOf(oriented(original, o, WORK));
    const a = alignCrop(g, q);
    if (a.score < score) {
      ({ rect, score } = a);
      orient = o;
      og = g;
    }
  }
  let detail = Infinity;
  if (og) ({ rect, score: detail } = detailScore(og, q, rect));
  const isFull = rect.w > 0.985 && rect.h > 0.985;
  // Not a trustworthy alignment: fall back to the plain diff (if allowed) or reject.
  if (score > ALIGN_MAX || detail > DETAIL_MAX || rect.w * rect.h < MIN_KEPT) return plain;
  if (isFull && orient.rot === 0 && !orient.mirror) return plain ?? { ...(await compareImages(original, query)), geometry: { rect: FULL, rotation: 0, mirrored: false, cropped: false, keptPercent: 100, alignScore: Math.round(score * 1000) / 1000, detailScore: Math.round(detail * 1000) / 1000 } };

  // Cut the matching region out of the FULL-resolution oriented original.
  const fullOriented = await oriented(original, orient).png().toBuffer();
  const meta = await sharp(fullOriented).metadata();
  const left = Math.round(rect.x * meta.width!);
  const top = Math.round(rect.y * meta.height!);
  const width = Math.min(meta.width! - left, Math.max(16, Math.round(rect.w * meta.width!)));
  const height = Math.min(meta.height! - top, Math.max(16, Math.round(rect.h * meta.height!)));
  const region = isFull ? fullOriented : await sharp(fullOriented).extract({ left, top, width, height }).png().toBuffer();

  const aligned = await compareImages(region, query);
  const geometry: Geometry = {
    rect: isFull ? FULL : rect,
    rotation: orient.rot,
    mirrored: orient.mirror,
    cropped: !isFull,
    keptPercent: Math.round(rect.w * rect.h * 1000) / 10,
    alignScore: Math.round(score * 1000) / 1000,
    detailScore: Math.round(detail * 1000) / 1000,
  };
  return plain && plain.changedPercent <= aligned.changedPercent ? plain : { ...aligned, geometry };
}
