// Measures live verify: pointing a camera at a sealed photo shown on a screen
// or printed. This is the evidence behind the thresholds and the alignment
// search in src/lib/live-match.ts.
//
//   npm run live:report
//
// For 8 test scenes it builds simulated camera frames: the photo sits inside
// the frame with a dark border (a screen bezel or table), off-centre and
// tilted, then lens blur, glare, dimming and sensor noise are added. Each
// frame is hashed two ways:
//   plain   one hash of the whole frame
//   search  the best of the SEARCH_GRID crops (what the app does)
// It also measures FALSE matches: every frame against every OTHER scene,
// because searching 135 crops gives an unrelated photo 135 chances.
import sharp from "sharp";
import { computePHash, hammingDistance } from "../src/lib/crypto/phash";
import { ASPECTS, boxThumb, cropRect, LIVE_CLOSE, LIVE_MATCH, SEARCH_GRID, WARPS, warpKey, type Warp } from "../src/lib/live-match";
import { makeScene } from "../test/fixtures/scenes";

const FRAME_W = 320; // the guide area, already downscaled like in the browser
const FRAME_H = 240;

type Scenario = { name: string; fill: number; ox: number; oy: number; tilt: number; rough: boolean; shear?: number };
const scenarios: Scenario[] = [
  { name: "fills 96% of the guide, centred", fill: 0.96, ox: 0, oy: 0, tilt: 0, rough: false },
  { name: "fills 85%, off-centre", fill: 0.85, ox: 0.04, oy: -0.03, tilt: 0, rough: false },
  { name: "fills 75%, centred", fill: 0.75, ox: 0, oy: 0, tilt: 0, rough: false },
  { name: "fills 88%, tilted 2°", fill: 0.88, ox: 0.02, oy: 0.02, tilt: 2, rough: false },
  { name: "realistic: 86%, off-centre, tilted, screen effects", fill: 0.86, ox: 0.03, oy: 0.02, tilt: 1.5, rough: true },
  { name: "realistic: 92%, tilted the other way, screen effects", fill: 0.92, ox: -0.02, oy: 0.03, tilt: -2, rough: true },
  { name: "phone held at an angle (6% shear), effects", fill: 0.86, ox: 0.01, oy: 0.02, tilt: 1, rough: true, shear: 0.06 },
  { name: "phone held at a steep angle (12% shear), effects", fill: 0.86, ox: 0.01, oy: 0.02, tilt: 1, rough: true, shear: 0.12 },
];

/** A soft white glare blob over one corner, like a reflection on a screen. */
const glare = (w: number, h: number, alpha: number) =>
  Buffer.from(
    `<svg width="${w}" height="${h}"><defs><radialGradient id="g" cx="0.2" cy="0.2" r="0.6">` +
      `<stop offset="0" stop-color="white" stop-opacity="${alpha}"/><stop offset="1" stop-color="white" stop-opacity="0"/>` +
      `</radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );

/** A camera frame: the photo placed on a dark background, then distorted. */
async function cameraFrame(photo: Buffer, s: Scenario): Promise<Buffer> {
  const pw = Math.round(FRAME_W * s.fill);
  const ph = Math.round(FRAME_H * s.fill);
  // Keep the photo's own shape (4:3 or 16:9), as on a real screen.
  let placed = await sharp(photo).resize(pw, ph, { fit: "inside" }).toBuffer();
  if (s.shear) placed = await sharp(placed).affine([[1, s.shear], [0, 1]], { background: "#181818" }).toBuffer();
  if (s.tilt) placed = await sharp(placed).rotate(s.tilt, { background: "#181818" }).toBuffer();
  const meta = await sharp(placed).metadata();
  const left = Math.round((FRAME_W - meta.width!) / 2 + s.ox * FRAME_W);
  const top = Math.round((FRAME_H - meta.height!) / 2 + s.oy * FRAME_H);
  let frame = await sharp({ create: { width: FRAME_W, height: FRAME_H, channels: 3, background: "#181818" } })
    .composite([{ input: placed, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer();
  if (s.rough) {
    frame = await sharp(frame).blur(1.2).linear(0.78, 22).composite([{ input: glare(FRAME_W, FRAME_H, 0.35) }]).png().toBuffer();
    const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
    let seed = 11;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = Math.max(0, Math.min(255, data[i] + ((seed % 25) - 12)));
    }
    frame = await sharp(data, { raw: info }).png().toBuffer();
  }
  return frame;
}

type Raw = { data: Buffer; w: number; h: number };
const raw = async (img: ReturnType<typeof sharp>): Promise<Raw> => {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

/** The same downscale the browser does (shared code). */
const thumb = (src: Raw, r: { x: number; y: number; w: number; h: number }) =>
  boxThumb({ width: src.w, height: src.h, data: src.data }, r);

/** Un-warps the frame about its centre, keeping its size (corners go dark), like the canvas. */
async function rotated(frame: Buffer, deg: number, shear = 0): Promise<Raw> {
  if (!deg && !shear) return raw(sharp(frame));
  const r = deg
    ? await sharp(frame).rotate(-deg, { background: "#181818" }).toBuffer()
    : await sharp(frame).affine([[1, -shear], [0, 1]], { background: "#181818" }).toBuffer();
  const m = await sharp(r).metadata();
  return raw(sharp(r).extract({ left: Math.round((m.width! - FRAME_W) / 2), top: Math.round((m.height! - FRAME_H) / 2), width: FRAME_W, height: FRAME_H }));
}

/** All the hashes the app computes for one frame. */
async function searchHashes(frame: Buffer): Promise<string[]> {
  const byWarp = new Map<string, Raw>();
  for (const w of WARPS as Warp[]) byWarp.set(warpKey(w), await rotated(frame, w.rot, w.shear));
  return ASPECTS.landscape.flatMap((aspect) =>
    SEARCH_GRID.map((c) => computePHash(thumb(byWarp.get(warpKey(c.warp))!, cropRect(c, FRAME_W, FRAME_H, aspect)))),
  );
}

// 8 phone-shaped (4:3) and 8 webcam-shaped (16:9) photos.
const scenes = [
  ...(await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((s) => makeScene(s, 1024, 768)))),
  ...(await Promise.all([11, 12, 13, 14, 15, 16, 17, 18].map((s) => makeScene(s, 1280, 720)))),
];
// The ledger stores the pHash of the full-size original.
const sealed = await Promise.all(
  scenes.map(async (s) => computePHash(await raw(sharp(s)).then((r) => ({ width: r.w, height: r.h, data: r.data })))),
);

const best = (hashes: string[], target: string) => Math.min(...hashes.map((h) => hammingDistance(h, target)));
const plain = new Map<string, number[]>();
const searched = new Map<string, number[]>();
const falseMatch: number[] = [];

for (const s of scenarios) {
  for (const [i, scene] of scenes.entries()) {
    const frame = await cameraFrame(scene, s);
    const whole = await rotated(frame, 0);
    const p = computePHash(thumb(whole, { x: 0, y: 0, w: FRAME_W, h: FRAME_H }));
    const hashes = await searchHashes(frame);
    plain.set(s.name, [...(plain.get(s.name) ?? []), hammingDistance(p, sealed[i])]);
    searched.set(s.name, [...(searched.get(s.name) ?? []), best(hashes, sealed[i])]);
    for (const [j, other] of sealed.entries()) if (j !== i) falseMatch.push(best(hashes, other));
  }
}

const stats = (xs: number[]) => `min ${String(Math.min(...xs)).padStart(2)} max ${String(Math.max(...xs)).padStart(2)} mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1).padStart(4)}`;
const rate = (xs: number[], t: number) => `${String(Math.round((100 * xs.filter((d) => d <= t).length) / xs.length)).padStart(3)}%`;

console.log(`\nLive verify: simulated camera frames of 16 sealed photos, 8 at 4:3 and 8 at 16:9 (Hamming distance / 64)`);
console.log(`  ${"".padEnd(52)} ${"plain hash".padEnd(22)} match  | ${"alignment search".padEnd(22)} close  match`);
for (const s of scenarios) {
  const p = plain.get(s.name)!, q = searched.get(s.name)!;
  console.log(`  ${s.name.padEnd(52)} ${stats(p).padEnd(22)} ${rate(p, LIVE_MATCH)}  | ${stats(q).padEnd(22)} ${rate(q, LIVE_CLOSE)}  ${rate(q, LIVE_MATCH)}`);
}
console.log(`  ${"FALSE matches (frame vs every other sealed scene)".padEnd(52)} ${"".padEnd(29)}| ${stats(falseMatch).padEnd(22)} ${rate(falseMatch, LIVE_CLOSE)}  ${rate(falseMatch, LIVE_MATCH)}`);
console.log(`\n  ${SEARCH_GRID.length * ASPECTS.landscape.length} crops per frame · LIVE_CLOSE = ${LIVE_CLOSE} · LIVE_MATCH = ${LIVE_MATCH}\n`);

// Threshold trade-off: true matches found vs false matches let through.
const allTrue = [...searched.values()].flat();
console.log("  threshold   true frames matched   false frames matched");
for (let t = 8; t <= 16; t++) console.log(`  ${String(t).padStart(9)}   ${rate(allTrue, t).padStart(19)}   ${rate(falseMatch, t).padStart(20)}`);
console.log(`  (${allTrue.length} true frames, ${falseMatch.length} false pairs)\n`);
