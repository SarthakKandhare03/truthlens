// Accuracy benchmark for verification: how often is each kind of copy given
// the RIGHT verdict (and linked to the RIGHT original)?
//
//   npm run benchmark                       generated photos (10 scenes)
//   npm run benchmark -- path/to/photos     your own photos (JPEG/PNG/WebP, 8+ recommended)
//
// Every photo is "sealed" in memory (exact hash, perceptual hash, variant
// fingerprints), then ~22 kinds of copy are made from it: exact copies,
// re-encodes, resizes, filters, crops, mirrors, rotations and content edits.
// Each copy is run through the verification logic twice:
//
//   baseline   the original pipeline: whole-image pHash shortlist + plain diff
//   improved   variant shortlist + alignment (src/lib/image/derivative.ts)
//
// Unrelated photos are tested leave-one-out: each photo is checked against a
// ledger that contains every OTHER photo, and must come out UNVERIFIED.
//
// Not covered here (tested elsewhere): signature checks and on-chain reads are
// exact cryptography (unit + e2e tests), so this measures the image matching.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sha256Hex } from "../src/lib/crypto/hash";
import { computePHash, hammingDistance, phashWords, PHASH_MATCH_THRESHOLD } from "../src/lib/crypto/phash";
import { decodeImage } from "../src/lib/image/decode-node";
import { compareImages, GRID_SIZE, NOT_A_DERIVATIVE_PERCENT } from "../src/lib/image/diff";
import { compareDerivative, computeVariants, FULL, shortlist, UPRIGHT, VARIANT_SHORTLIST, type IndexedVariant } from "../src/lib/image/derivative";
import { makeScene } from "../test/fixtures/scenes";

type Verdict = "AUTHENTIC" | "EDITED" | "UNVERIFIED";
type Copy = { bytes: Buffer; region?: { x: number; y: number; w: number; h: number } }; // region: the edit, in fractions of the copy
type Transform = { name: string; group: string; expect: Verdict; make: (o: Buffer, donor: Buffer) => Promise<Copy> };

// ---------------------------------------------------------------- photos
const dir = process.argv[2];
const originals: { name: string; bytes: Buffer }[] = [];
if (dir) {
  for (const f of (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()) {
    // Normalise to an upright JPEG, as the capture page produces.
    const bytes = await sharp(await readFile(path.join(dir, f))).autoOrient().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    originals.push({ name: f, bytes });
  }
  if (originals.length < 3) throw new Error("Put at least 3 photos (8+ recommended) in " + dir);
} else {
  for (const s of [1, 2, 3, 4, 5]) originals.push({ name: `scene-${s} (4:3)`, bytes: await sharp(await makeScene(s)).jpeg({ quality: 92 }).toBuffer() });
  for (const s of [11, 12, 13, 14, 15]) originals.push({ name: `scene-${s} (16:9)`, bytes: await sharp(await makeScene(s, 1280, 720)).jpeg({ quality: 92 }).toBuffer() });
}

// ---------------------------------------------------------------- copies
const meta = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return { w: m.width!, h: m.height! };
};
const jpeg = (img: ReturnType<typeof sharp>, q = 88) => img.jpeg({ quality: q }).toBuffer();
async function crop(o: Buffer, l: number, t: number, r: number, b: number) {
  const { w, h } = await meta(o);
  return sharp(o).extract({ left: Math.round(w * l), top: Math.round(h * t), width: Math.round(w * (1 - l - r)), height: Math.round(h * (1 - t - b)) });
}
async function paste(o: Buffer, donor: Buffer, size: number, at: { x: number; y: number }): Promise<Copy> {
  const { w, h } = await meta(o);
  const pw = Math.round(w * size), ph = Math.round(h * size);
  const patch = await sharp(donor).resize(pw, ph, { fit: "cover" }).toBuffer();
  const left = Math.round((w - pw) * at.x), top = Math.round((h - ph) * at.y);
  return { bytes: await jpeg(sharp(o).composite([{ input: patch, left, top }])), region: { x: left / w, y: top / h, w: pw / w, h: ph / h } };
}

const transforms: Transform[] = [
  { name: "exact copy", group: "identical", expect: "AUTHENTIC", make: async (o) => ({ bytes: o }) },
  { name: "re-encoded (JPEG q60)", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o), 60) }) },
  { name: "resized to 50%", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).resize({ width: Math.round((await meta(o)).w / 2) })) }) },
  { name: "WhatsApp-style (1280 px, q70)", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).resize(1280, 1280, { fit: "inside" }), 70) }) },
  { name: "screenshot (PNG)", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await sharp(o).png().toBuffer() }) },
  { name: "brightness + contrast", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).linear(1.15, 12)) }) },
  { name: "grayscale filter", group: "harmless", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).grayscale()) }) },
  { name: "crop 5% per side", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(await crop(o, 0.05, 0.05, 0.05, 0.05)) }) },
  { name: "crop 10% per side", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(await crop(o, 0.1, 0.1, 0.1, 0.1)) }) },
  { name: "crop 20% per side", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(await crop(o, 0.2, 0.2, 0.2, 0.2)) }) },
  { name: "off-centre crop (keeps 49%)", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(await crop(o, 0.25, 0.05, 0.05, 0.25)) }) },
  {
    name: "square crop (Instagram)",
    group: "geometry",
    expect: "EDITED",
    make: async (o) => {
      const { w, h } = await meta(o);
      const s = Math.min(w, h);
      return { bytes: await jpeg(sharp(o).extract({ left: Math.round((w - s) / 2), top: Math.round((h - s) / 2), width: s, height: s })) };
    },
  },
  { name: "mirrored", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).flop()) }) },
  { name: "mirrored + crop 10%", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg((await crop(o, 0.1, 0.1, 0.1, 0.1)).flop()) }) },
  { name: "rotated 90°", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).rotate(90)) }) },
  { name: "rotated 180°", group: "geometry", expect: "EDITED", make: async (o) => ({ bytes: await jpeg(sharp(o).rotate(180)) }) },
  {
    name: "caption text added",
    group: "content",
    expect: "EDITED",
    make: async (o) => {
      const { w, h } = await meta(o);
      const svg = Buffer.from(`<svg width="${w}" height="${h}"><text x="${w * 0.06}" y="${h * 0.9}" font-size="${h * 0.07}" font-family="Arial" font-weight="bold" fill="white" stroke="black" stroke-width="3">BREAKING: FAKE CAPTION</text></svg>`);
      return { bytes: await jpeg(sharp(o).composite([{ input: svg }])), region: { x: 0.04, y: 0.8, w: 0.8, h: 0.13 } };
    },
  },
  { name: "pasted object (5% of area)", group: "content", expect: "EDITED", make: (o, d) => paste(o, d, 0.22, { x: 0.3, y: 0.4 }) },
  { name: "pasted object (12% of area)", group: "content", expect: "EDITED", make: (o, d) => paste(o, d, 0.35, { x: 0.7, y: 0.3 }) },
  {
    name: "erased region (inpainting-like smudge)",
    group: "content",
    expect: "EDITED",
    make: async (o) => {
      const { w, h } = await meta(o);
      const r = { left: Math.round(w * 0.55), top: Math.round(h * 0.15), width: Math.round(w * 0.25), height: Math.round(h * 0.3) };
      const smudge = await sharp(o).extract(r).blur(25).toBuffer();
      return { bytes: await jpeg(sharp(o).composite([{ input: smudge, left: r.left, top: r.top }])), region: { x: 0.55, y: 0.15, w: 0.25, h: 0.3 } };
    },
  },
  {
    name: "crop 15% + pasted object",
    group: "content",
    expect: "EDITED",
    make: async (o, d) => {
      const pasted = await paste(o, d, 0.3, { x: 0.5, y: 0.5 });
      const c = await jpeg(await crop(pasted.bytes, 0.15, 0.15, 0.15, 0.15));
      const r = pasted.region!;
      return { bytes: c, region: { x: (r.x - 0.15) / 0.7, y: (r.y - 0.15) / 0.7, w: r.w / 0.7, h: r.h / 0.7 } };
    },
  },
];

// ---------------------------------------------------------------- sealing (in memory)
type Sealed = { name: string; sha256: string; bytes: Buffer; pHash: string };
const sealed: Sealed[] = [];
const variantEntries: IndexedVariant[] = [];
const plainEntries: IndexedVariant[] = [];
const t0 = performance.now();
for (const o of originals) {
  const sha256 = await sha256Hex(o.bytes);
  const pHash = computePHash(await decodeImage(o.bytes));
  sealed.push({ name: o.name, sha256, bytes: o.bytes, pHash });
  const plain = { sha256, words: phashWords(pHash), variant: { orient: UPRIGHT, rect: FULL } };
  plainEntries.push(plain);
  variantEntries.push(plain);
  for (const v of await computeVariants(o.bytes)) variantEntries.push({ sha256, words: phashWords(v.pHash), variant: v });
}
const variantMs = (performance.now() - t0) / originals.length;

// ---------------------------------------------------------------- the two pipelines
type Result = { verdict: Verdict; sha256: string | null; changed: number | null; grid: number[] | null; ms: number; trace: string[] };
const DEBUG = process.env.BENCH_DEBUG === "1";

async function verify(query: Buffer, mode: "baseline" | "improved", exclude?: string): Promise<Result> {
  const start = performance.now();
  const sha = await sha256Hex(query);
  const exact = sealed.find((s) => s.sha256 === sha && s.sha256 !== exclude);
  if (exact) return { verdict: "AUTHENTIC", sha256: exact.sha256, changed: 0, grid: null, ms: performance.now() - start, trace: [] };
  const trace: string[] = [];

  const pHash = computePHash(await decodeImage(query));
  const entries = (mode === "baseline" ? plainEntries : variantEntries).filter((e) => e.sha256 !== exclude);
  let best: { sha256: string; changed: number; grid: number[] } | null = null;
  const candidates = mode === "baseline" ? shortlist(pHash, entries, PHASH_MATCH_THRESHOLD, 3) : shortlist(pHash, entries, VARIANT_SHORTLIST, 4);
  for (const c of candidates) {
    const original = sealed.find((s) => s.sha256 === c.sha256)!;
    const plainAllowed = hammingDistance(pHash, original.pHash) <= PHASH_MATCH_THRESHOLD;
    const diff = mode === "baseline" ? await compareImages(original.bytes, query) : await compareDerivative(original.bytes, query, c.variant.orient, plainAllowed);
    if (!diff) {
      trace.push(`${original.name} d=${c.distance} via ${c.variant.orient.rot}${c.variant.orient.mirror ? "m" : ""}/${c.variant.rect.w.toFixed(2)} → rejected (not this copy's original)`);
      continue;
    }
    if ("geometry" in diff) {
      const g = (diff as NonNullable<Awaited<ReturnType<typeof compareDerivative>>>).geometry;
      trace.push(`${original.name} d=${c.distance} via ${c.variant.orient.rot}${c.variant.orient.mirror ? "m" : ""}/${c.variant.rect.w.toFixed(2)} → changed ${diff.changedPercent}% kept ${g.keptPercent}% align ${g.alignScore} detail ${g.detailScore}`);
    }
    if (diff.changedPercent > NOT_A_DERIVATIVE_PERCENT) continue;
    if (!best || diff.changedPercent < best.changed) best = { sha256: c.sha256, changed: diff.changedPercent, grid: diff.grid };
  }
  const ms = performance.now() - start;
  return best
    ? { verdict: "EDITED", sha256: best.sha256, changed: best.changed, grid: best.grid, ms, trace }
    : { verdict: "UNVERIFIED", sha256: null, changed: null, grid: null, ms, trace };
}

/** Of the grid cells the true edit covers, the share flagged; and of the flagged cells, the share near the edit. */
function localisation(grid: number[], region: NonNullable<Copy["region"]>) {
  const inRegion = (r: number, c: number, pad: number) =>
    (c + 1) / GRID_SIZE > region.x - pad && c / GRID_SIZE < region.x + region.w + pad && (r + 1) / GRID_SIZE > region.y - pad && r / GRID_SIZE < region.y + region.h + pad;
  let truth = 0, found = 0, flagged = 0, flaggedNear = 0;
  for (let r = 0; r < GRID_SIZE; r++)
    for (let c = 0; c < GRID_SIZE; c++) {
      const hot = grid[r * GRID_SIZE + c] >= 0.05;
      if (inRegion(r, c, 0)) {
        truth++;
        if (hot) found++;
      }
      if (hot) {
        flagged++;
        if (inRegion(r, c, 1 / GRID_SIZE)) flaggedNear++;
      }
    }
  return { recall: truth ? found / truth : 1, precision: flagged ? flaggedNear / flagged : 1 };
}

// ---------------------------------------------------------------- run
type Row = { name: string; group: string; expect: Verdict; n: number; ok: { baseline: number; improved: number }; loc: { recall: number[]; precision: number[] } };
const rows: Row[] = [];
const confusion = { baseline: new Map<string, number>(), improved: new Map<string, number>() };
const times: number[] = [];
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

console.log(`\nTruthLens accuracy benchmark: ${originals.length} photos${dir ? ` from ${dir}` : " (generated)"} × ${transforms.length} kinds of copy + leave-one-out unrelated checks`);
for (const t of transforms) {
  const row: Row = { name: t.name, group: t.group, expect: t.expect, n: 0, ok: { baseline: 0, improved: 0 }, loc: { recall: [], precision: [] } };
  for (const [i, s] of sealed.entries()) {
    const donor = sealed[(i + 1) % sealed.length].bytes;
    const copy = await t.make(s.bytes, donor);
    row.n++;
    for (const mode of ["baseline", "improved"] as const) {
      const r = await verify(copy.bytes, mode);
      if (mode === "improved") times.push(r.ms);
      // Right verdict AND (for AUTHENTIC/EDITED) the right original.
      const right = r.verdict === t.expect && (t.expect === "UNVERIFIED" || r.sha256 === s.sha256);
      if (right) row.ok[mode]++;
      if (DEBUG && mode === "improved") console.log(`
  ${right ? "ok " : "BAD"} ${t.name} [${s.name}] → ${r.verdict}  ${r.trace.join(" | ") || "(no candidate)"}`);
      bump(confusion[mode], `${t.expect}→${r.verdict}`);
      if (mode === "improved" && right && copy.region && r.grid) {
        const l = localisation(r.grid, copy.region);
        row.loc.recall.push(l.recall);
        row.loc.precision.push(l.precision);
      }
    }
  }
  rows.push(row);
  process.stdout.write(".");
}
// Unrelated photos, leave-one-out.
const unrelated: Row = { name: "unrelated photo (not sealed)", group: "unrelated", expect: "UNVERIFIED", n: 0, ok: { baseline: 0, improved: 0 }, loc: { recall: [], precision: [] } };
for (const s of sealed) {
  for (const copy of [s.bytes, await jpeg(sharp(s.bytes).resize({ width: 900 }), 75)]) {
    unrelated.n++;
    for (const mode of ["baseline", "improved"] as const) {
      const r = await verify(copy, mode, s.sha256);
      if (r.verdict === "UNVERIFIED") unrelated.ok[mode]++;
      if (DEBUG && mode === "improved") console.log(`
  ${r.verdict === "UNVERIFIED" ? "ok " : "BAD"} unrelated [${s.name}] → ${r.verdict}  ${r.trace.join(" | ") || "(no candidate)"}`);
      bump(confusion[mode], `UNVERIFIED→${r.verdict}`);
    }
  }
}
rows.push(unrelated);
console.log("\n");

// ---------------------------------------------------------------- report
const pct = (a: number, n: number) => `${Math.round((100 * a) / n)}%`.padStart(5);
const avg = (xs: number[]) => (xs.length ? `${Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length)}%` : "  -");
console.log(`  ${"kind of copy".padEnd(40)} ${"expected".padEnd(11)} baseline  improved   edit found  flagged cells on target`);
let group = "";
for (const r of rows) {
  if (r.group !== group) {
    group = r.group;
    console.log(`  \x1b[2m── ${group}\x1b[0m`);
  }
  const mark = r.ok.improved === r.n ? "\x1b[32m" : r.ok.improved / r.n >= 0.8 ? "\x1b[33m" : "\x1b[31m";
  console.log(`  ${r.name.padEnd(40)} ${r.expect.padEnd(11)} ${pct(r.ok.baseline, r.n)}     ${mark}${pct(r.ok.improved, r.n)}\x1b[0m     ${avg(r.loc.recall).padStart(6)}      ${avg(r.loc.precision).padStart(6)}`);
}

const totals = (mode: "baseline" | "improved") => rows.reduce((a, r) => a + r.ok[mode], 0);
const total = rows.reduce((a, r) => a + r.n, 0);
console.log(`\n  overall: baseline ${totals("baseline")}/${total} (${pct(totals("baseline"), total).trim()})   improved ${totals("improved")}/${total} (${pct(totals("improved"), total).trim()})`);

for (const mode of ["baseline", "improved"] as const) {
  console.log(`\n  confusion matrix (${mode}): rows = truth, columns = verdict`);
  console.log(`  ${"".padEnd(12)} ${"AUTHENTIC".padStart(10)} ${"EDITED".padStart(8)} ${"UNVERIFIED".padStart(11)}`);
  for (const truth of ["AUTHENTIC", "EDITED", "UNVERIFIED"] as const) {
    const cell = (v: Verdict) => String(confusion[mode].get(`${truth}→${v}`) ?? 0);
    console.log(`  ${truth.padEnd(12)} ${cell("AUTHENTIC").padStart(10)} ${cell("EDITED").padStart(8)} ${cell("UNVERIFIED").padStart(11)}`);
  }
}
const sorted = [...times].sort((a, b) => a - b);
console.log(`\n  improved pipeline: median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms per verification, 95th pct ${Math.round(sorted[Math.floor(sorted.length * 0.95)])} ms; variant fingerprints ${Math.round(variantMs)} ms per sealed photo\n`);

await mkdir("test-results", { recursive: true });
await writeFile("test-results/benchmark.json", JSON.stringify({ photos: originals.map((o) => o.name), rows, confusion: { baseline: Object.fromEntries(confusion.baseline), improved: Object.fromEntries(confusion.improved) } }, null, 2));
