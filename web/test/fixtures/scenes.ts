// Deterministic, photo-like test images plus the "real world" transformations
// a photo goes through (recompression, resizing, filters, edits).
//
// Used by the unit tests and by `npm run phash:report`. Scenes are generated
// from a seed rather than checked in as binary files, so the tests are
// reproducible and the repo stays small.
import sharp from "sharp";

/** Small seeded PRNG (mulberry32): the same seed always gives the same scene. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENE_WIDTH = 1600;
export const SCENE_HEIGHT = 1200;

/**
 * A 1600×1200 JPEG (quality 92, like a phone camera) with a gradient sky,
 * overlapping soft-edged shapes and gaussian sensor-style grain.
 */
export async function makeScene(seed: number, width = SCENE_WIDTH, height = SCENE_HEIGHT): Promise<Buffer> {
  const r = prng(seed);
  const hsl = (lMin = 15, lMax = 80) =>
    `hsl(${Math.floor(r() * 360)} ${Math.floor(30 + r() * 60)}% ${Math.floor(lMin + r() * (lMax - lMin))}%)`;

  const defs: string[] = [];
  const shapes: string[] = [];
  for (let i = 0; i < 28; i++) {
    defs.push(
      `<radialGradient id="g${i}"><stop offset="0" stop-color="${hsl()}"/><stop offset="1" stop-color="${hsl()}"/></radialGradient>`,
    );
    const cx = r() * width;
    const cy = r() * height;
    const size = (0.05 + r() * 0.3) * width;
    const opacity = (0.55 + r() * 0.45).toFixed(2);
    const rot = Math.floor(r() * 180);
    shapes.push(
      r() < 0.5
        ? `<ellipse cx="${cx}" cy="${cy}" rx="${size / 2}" ry="${size / (1.5 + r() * 2)}" fill="url(#g${i})" opacity="${opacity}" transform="rotate(${rot} ${cx} ${cy})"/>`
        : `<rect x="${cx - size / 2}" y="${cy - size / 3}" width="${size}" height="${(size * 2) / 3}" rx="${size * 0.1}" fill="url(#g${i})" opacity="${opacity}" transform="rotate(${rot} ${cx} ${cy})"/>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="${hsl(30, 85)}"/><stop offset="1" stop-color="${hsl(10, 50)}"/>
      </linearGradient>
      ${defs.join("\n")}
    </defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    ${shapes.join("\n")}
  </svg>`;

  // Sensor-style grain from the seeded PRNG (sharp's built-in noise generator
  // is random on every call, which would make tests flaky). Sum of three
  // uniforms ≈ gaussian, centred on mid-grey so soft-light leaves tones intact.
  const grainPixels = Buffer.alloc(width * height);
  for (let i = 0; i < grainPixels.length; i++) {
    grainPixels[i] = Math.max(0, Math.min(255, Math.round(128 + (r() + r() + r() - 1.5) * 48)));
  }
  const grain = await sharp(grainPixels, { raw: { width, height, channels: 1 } })
    .toColourspace("srgb")
    .png()
    .toBuffer();

  return sharp(Buffer.from(svg))
    .composite([{ input: grain, blend: "soft-light" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export type Variant = {
  name: string;
  bytes: Buffer;
  /** "benign": the same photo after normal handling (should MATCH).
   *  "edit":   content was changed (should be caught as EDITED or worse). */
  kind: "benign" | "edit";
};

/** Rectangle covering `fraction` of the image area, positioned left of centre. */
function region(w: number, h: number, fraction: number) {
  const side = Math.sqrt(fraction);
  const width = Math.round(w * side);
  const height = Math.round(h * side);
  return { left: Math.round(w * 0.2), top: Math.round(h * 0.25), width, height };
}

/** Everything a photo typically goes through, applied to one original. */
export async function makeVariants(original: Buffer, donor?: Buffer): Promise<Variant[]> {
  // Decode once to learn the upright (EXIF-rotated) size; real phone photos
  // often store pixels sideways plus an orientation flag.
  const { info } = await sharp(original).rotate().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const img = () => sharp(original).rotate();

  const benign: [string, Promise<Buffer>][] = [
    ["PNG re-encode (lossless)", img().png().toBuffer()],
    ["JPEG quality 75", img().jpeg({ quality: 75 }).toBuffer()],
    ["JPEG quality 50", img().jpeg({ quality: 50 }).toBuffer()],
    ["JPEG quality 30", img().jpeg({ quality: 30 }).toBuffer()],
    ["Resize to 50%", img().resize(Math.round(w / 2)).jpeg({ quality: 85 }).toBuffer()],
    ["Resize to 25%", img().resize(Math.round(w / 4)).jpeg({ quality: 85 }).toBuffer()],
    [
      "WhatsApp-style (fit 1280px, q70)",
      img().resize(1280, 1280, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer(),
    ],
    [
      "Double recompress (q85 → q60)",
      img().jpeg({ quality: 85 }).toBuffer().then((b) => sharp(b).jpeg({ quality: 60 }).toBuffer()),
    ],
    ["Brightness +15%", img().modulate({ brightness: 1.15 }).jpeg({ quality: 85 }).toBuffer()],
    ["Contrast +20%", img().linear(1.2, -25).jpeg({ quality: 85 }).toBuffer()],
    ["Saturation filter", img().modulate({ saturation: 1.6 }).jpeg({ quality: 85 }).toBuffer()],
    ["Grayscale", img().grayscale().jpeg({ quality: 85 }).toBuffer()],
  ];

  const small = region(w, h, 0.05);
  const medium = region(w, h, 0.12);
  const large = region(w, h, 0.25);
  const patch = (rect: { width: number; height: number }, colour: string) =>
    sharp({ create: { width: rect.width, height: rect.height, channels: 3, background: colour } })
      .png()
      .toBuffer();
  const donorPatch = donor
    ? sharp(donor).extract({ ...large, left: Math.round(w * 0.5), top: Math.round(h * 0.4) }).toBuffer()
    : patch(large, "#3a5f2b");
  const caption = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${w * 0.08}" y="${h * 0.9}" font-family="Arial" font-weight="700" font-size="${h * 0.09}" fill="#ffffff">FAKE NEWS 2026</text></svg>`,
  );

  const edits: [string, Promise<Buffer>][] = [
    [
      "Edit: object pasted (5% area)",
      patch(small, "#d02020").then((p) => img().composite([{ input: p, left: small.left, top: small.top }]).jpeg({ quality: 90 }).toBuffer()),
    ],
    [
      "Edit: object pasted (12% area)",
      patch(medium, "#202080").then((p) => img().composite([{ input: p, left: medium.left, top: medium.top }]).jpeg({ quality: 90 }).toBuffer()),
    ],
    [
      "Edit: region swapped from other photo (25%)",
      donorPatch.then((p) => img().composite([{ input: p, left: large.left, top: large.top }]).jpeg({ quality: 90 }).toBuffer()),
    ],
    ["Edit: caption text added", img().composite([{ input: caption }]).jpeg({ quality: 90 }).toBuffer()],
    [
      "Edit: cropped 8% each side",
      img()
        .extract({ left: Math.round(w * 0.08), top: Math.round(h * 0.08), width: Math.round(w * 0.84), height: Math.round(h * 0.84) })
        .jpeg({ quality: 90 })
        .toBuffer(),
    ],
    ["Edit: mirrored", img().flop().jpeg({ quality: 90 }).toBuffer()],
  ];

  const out: Variant[] = [];
  for (const [name, p] of benign) out.push({ name, bytes: await p, kind: "benign" });
  for (const [name, p] of edits) out.push({ name, bytes: await p, kind: "edit" });
  return out;
}
