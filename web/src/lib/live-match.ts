// Live verify: decides, from a stream of per-frame results, whether the camera
// is looking at a sealed photo. Pure TypeScript (no browser or Node APIs), so
// it is unit-tested directly.
//
// Each camera frame gives at most one candidate: the closest sealed photo by
// perceptual hash, and how many of the 64 bits differ. A single frame is
// noisy (motion blur, autofocus hunting, a hand moving into view), so the
// verdict comes from a sliding window of recent frames: a photo is LOCKED
// only when it wins at least NEED_HITS of the last WINDOW frames.
//
// Thresholds, measured with `npm run live:report`: simulated camera frames of
// 16 sealed photos (8 at 4:3, 8 at 16:9) shown on a screen with a border,
// off-centre, tilted, filmed at an angle (shear up to 12%), blurred, dimmed,
// with glare and sensor noise. 128 true frames vs 1,920 frame/unrelated-photo
// pairs, with the alignment search:
//
//   threshold   true frames matched   false frames matched
//        10              97%                   0%
//        11              97%                   0%     <- LIVE_MATCH
//        12             100%                   0%
//        16             100%                   2%
//
// The alignment search tries 450 crops, which gives an unrelated photo 450
// chances to land close (the closest unrelated pair was 12 bits), so live
// mode is STRICTER than file verification (16). One missed frame does not
// matter: a lock needs 3 of the last 6 frames anyway.
//
// A re-captured photo can never be "AUTHENTIC": its bytes are new. Live mode
// FINDS the sealed original; the file itself proves bit-for-bit authenticity.
export const LIVE_CLOSE = 6;
export const LIVE_MATCH = 11;
export const WINDOW = 6;
export const NEED_HITS = 3;

/**
 * Alignment search. The photo inside the camera guide is never framed exactly
 * like the original: there is a border, it is off-centre, the phone is tilted.
 * A perceptual hash is sensitive to exactly that (framing errors cost 10-20
 * bits, while blur, glare and noise cost 0-10). So every frame is hashed at a
 * grid of crops: zoom × horizontal shift × vertical shift × warp, and the
 * best-aligned crop is the one compared. 5 × 3 × 3 × 5 = 225 crops per photo shape,
 * computed on 64-pixel thumbnails, a few milliseconds per frame.
 *
 *   scale  fraction of the guide area kept (1 = all of it)
 *   dx/dy  shift of the crop centre, as a fraction of the guide size
 *   warp   undoes a tilt (rotation, degrees) or the phone being held at an
 *          angle (horizontal shear, the slant a photo takes when filmed from
 *          the side), applied about the centre before cropping
 */
export type Warp = { rot: number; shear: number };
export const WARPS: Warp[] = [
  { rot: -2, shear: 0 },
  { rot: 0, shear: 0 },
  { rot: 2, shear: 0 },
  { rot: 0, shear: -0.08 },
  { rot: 0, shear: 0.08 },
];
export const warpKey = (w: Warp) => `${w.rot}/${w.shear}`;
export type Crop = { scale: number; dx: number; dy: number; warp: Warp };
export const SCALES = [1, 0.93, 0.86, 0.79, 0.72];
export const SHIFTS = [-0.04, 0, 0.04];
export const SEARCH_GRID: Crop[] = SCALES.flatMap((scale) =>
  SHIFTS.flatMap((dx) => SHIFTS.flatMap((dy) => WARPS.map((warp) => ({ scale, dx, dy, warp })))),
);

/**
 * Photo shapes searched on every frame. A perceptual hash squashes any crop to
 * 32×32, so a crop with the wrong aspect ratio never lines up with the sealed
 * original: phones usually shoot 4:3, webcams 16:9. Both are tried, giving
 * 2 × 225 = 450 hashes per frame.
 */
export const ASPECTS = { landscape: [4 / 3, 16 / 9], portrait: [3 / 4, 9 / 16] } as const;

/**
 * The source rectangle (in pixels of a w × h frame) that a crop takes: the
 * largest rectangle of the given aspect ratio that fits the frame, scaled by
 * `c.scale` and shifted by `c.dx`/`c.dy`, kept inside the frame.
 */
export function cropRect(c: Crop, w: number, h: number, aspect = w / h): { x: number; y: number; w: number; h: number } {
  let fw = w;
  let fh = w / aspect;
  if (fh > h) {
    fh = h;
    fw = h * aspect;
  }
  const cw = fw * c.scale;
  const ch = fh * c.scale;
  const x = Math.min(Math.max(w / 2 + c.dx * w - cw / 2, 0), w - cw);
  const y = Math.min(Math.max(h / 2 + c.dy * h - ch / 2, 0), h - ch);
  return { x, y, w: cw, h: ch };
}

/** Long side of the thumbnail each crop is reduced to before hashing. */
export const THUMB = 64;

type Rgba = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/**
 * Box-averages a source rectangle into a small RGBA thumbnail (long side
 * THUMB). The browser and `npm run live:report` both use this exact routine,
 * so the measurements describe what the app really does.
 */
export function boxThumb(src: Rgba, r: { x: number; y: number; w: number; h: number }): Rgba {
  const tw = r.w >= r.h ? THUMB : Math.max(32, Math.round((THUMB * r.w) / r.h));
  const th = r.w >= r.h ? Math.max(32, Math.round((THUMB * r.h) / r.w)) : THUMB;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(r.y + (ty * r.h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(r.y + ((ty + 1) * r.h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(r.x + (tx * r.w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(r.x + ((tx + 1) * r.w) / tw));
      let red = 0, green = 0, blue = 0, n = 0;
      for (let y = y0; y < y1 && y < src.height; y++) {
        for (let x = x0; x < x1 && x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          red += src.data[i]; green += src.data[i + 1]; blue += src.data[i + 2]; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      n ||= 1;
      out[o] = red / n; out[o + 1] = green / n; out[o + 2] = blue / n; out[o + 3] = 255;
    }
  }
  return { width: tw, height: th, data: out };
}

/**
 * Mean brightness (0–255) and contrast (standard deviation) of a frame, so the
 * UI can say "too dark" or "nothing in view" instead of failing silently.
 */
export function frameLight(src: Rgba): { mean: number; contrast: number } {
  let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < src.data.length; i += 16) { // every 4th pixel is plenty
    const l = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
    sum += l; sq += l * l; n++;
  }
  const mean = sum / n;
  return { mean, contrast: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

export type FrameResult = { sha256: string; distance: number } | null;

export type LiveState =
  | { kind: "warming" } // not enough frames yet
  | { kind: "searching" } // frames are arriving, nothing has locked yet
  | { kind: "none" } // a full window and not one frame came close: no sealed original
  | { kind: "match"; sha256: string; distance: number; hits: number; close: boolean };

/** The newest WINDOW results, newest last. */
export function pushFrame(history: FrameResult[], result: FrameResult): FrameResult[] {
  return [...history, result].slice(-WINDOW);
}

/** Verdict for the current window of frame results. */
export function decide(history: FrameResult[]): LiveState {
  if (history.length < NEED_HITS) return { kind: "warming" };

  // Count how often each sealed photo was the (in-range) winner.
  const wins = new Map<string, number[]>();
  for (const r of history) {
    if (r && r.distance <= LIVE_MATCH) wins.set(r.sha256, [...(wins.get(r.sha256) ?? []), r.distance]);
  }
  let best: { sha256: string; distances: number[] } | null = null;
  for (const [sha256, distances] of wins) {
    if (!best || distances.length > best.distances.length) best = { sha256, distances };
  }
  if (!best) return history.length >= WINDOW ? { kind: "none" } : { kind: "searching" };
  if (best.distances.length < NEED_HITS) return { kind: "searching" };

  // The median is robust to one bad frame in either direction.
  const sorted = [...best.distances].sort((a, b) => a - b);
  const distance = sorted[Math.floor(sorted.length / 2)];
  return { kind: "match", sha256: best.sha256, distance, hits: best.distances.length, close: distance <= LIVE_CLOSE };
}

/** 0–100: share of the 64 bits that agree, the same scale as file verification
 *  (100% = identical, ~50% = unrelated photos). */
export function likeness(distance: number): number {
  return Math.round(100 * (1 - distance / 64));
}
