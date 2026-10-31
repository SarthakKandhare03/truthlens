// Perceptual hash (pHash): a 64-bit fingerprint of what an image LOOKS like.
//
// SHA-256 changes completely if a single byte changes, so it cannot recognise
// a photo after WhatsApp recompresses or resizes it. A perceptual hash is built
// to stay (almost) the same under those changes and to differ a lot between
// unrelated images. Two hashes are compared by Hamming distance, the number of
// bits that differ (0 = visually identical, ~32 = unrelated).
//
// Algorithm (the classic DCT-based pHash):
//   1. Convert to grayscale. Colour shifts and filters barely matter.
//   2. Shrink to 32×32 by averaging blocks of pixels. This throws away the
//      fine detail and noise that recompression or resizing would change.
//   3. Run a 2-D Discrete Cosine Transform (DCT), the same transform JPEG
//      uses, which splits the image into frequencies (coarse shapes →
//      fine texture).
//   4. Keep the 8×8 lowest frequencies, skipping the very first row and column
//      (the first coefficient is just average brightness, which carries no
//      structure). Those 64 numbers describe the image's overall structure.
//   5. Each bit = "is this coefficient above the median of the 64?" That gives
//      64 bits, which are robust to global brightness or contrast changes.
//
// Why pHash rather than dHash (a simpler gradient hash)? JPEG compression works
// in DCT space and mostly discards high frequencies, which pHash ignores by
// design. So pHash is noticeably more stable under heavy recompression, at the
// cost of a little more maths. On a 12-megapixel photo it still takes only tens
// of milliseconds, and nearly all of that is step 2.
//
// This file is pure TypeScript with no browser or Node APIs, so it gives the
// same answer in both. Decoding the file into pixels happens elsewhere
// (src/lib/image/).

/** Decoded pixels: 4 bytes per pixel (R, G, B, A), row by row. */
export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

const GRID = 32; // size of the downscaled image fed to the DCT
const LOW = 8; // keep LOW×LOW low-frequency coefficients → 64 bits

/** Bits that may differ (out of 64) for two images to count as the "same picture".
 *  Chosen by measurement; see the threshold notes at the bottom of this file. */
export const PHASH_MATCH_THRESHOLD = 16;

// ---------------------------------------------------------------------------
// Step 1 + 2: grayscale and block-average down to 32×32
// ---------------------------------------------------------------------------

/**
 * Returns a 32×32 grid (row-major) of average luminance values (0–255).
 * Every source pixel is assigned to exactly one grid cell, so all of the image
 * contributes. That makes the result stable whatever resolution a copy has.
 */
export function toGrayGrid(img: RgbaImage): Float64Array {
  const { width: w, height: h, data } = img;
  if (w < GRID || h < GRID) {
    throw new Error(`Image too small for a perceptual hash (${w}×${h}, minimum ${GRID}×${GRID})`);
  }
  if (data.length < w * h * 4) throw new Error("Pixel buffer is smaller than width × height × 4");

  // Precompute which grid column/row each source x/y falls into.
  const cellX = new Int32Array(w);
  for (let x = 0; x < w; x++) cellX[x] = Math.floor((x * GRID) / w);

  const sums = new Float64Array(GRID * GRID);
  const counts = new Float64Array(GRID * GRID);

  for (let y = 0; y < h; y++) {
    const rowBase = Math.floor((y * GRID) / h) * GRID;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      // ITU-R BT.601 luma weights: green matters most to the human eye.
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const cell = rowBase + cellX[x];
      sums[cell] += luma;
      counts[cell] += 1;
    }
  }

  for (let c = 0; c < sums.length; c++) sums[c] /= counts[c];
  return sums;
}

// ---------------------------------------------------------------------------
// Step 3 + 4: 2-D DCT, keeping only the low frequencies we need
// ---------------------------------------------------------------------------

// COS[k][n] = cos((2n + 1)·k·π / 2N), the DCT-II basis, computed once.
const COS: Float64Array[] = Array.from({ length: LOW + 1 }, (_, k) => {
  const row = new Float64Array(GRID);
  for (let n = 0; n < GRID; n++) row[n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * GRID));
  return row;
});

/**
 * DCT coefficients F(u, v) for u, v in 1..8, row-major (64 values).
 * The DCT is separable: transform every row, then the columns of that result.
 * We only compute the 9 frequencies (0..8) we actually use, not all 32.
 * Normalisation constants are omitted. They scale all coefficients equally
 * (index 0 is skipped), so they cannot change which side of the median a
 * value falls on.
 */
export function lowFrequencyDct(grid: Float64Array): Float64Array {
  // rowsT[u][y] = Σ_x grid[y][x] · COS[u][x]
  const rowsT = Array.from({ length: LOW + 1 }, () => new Float64Array(GRID));
  for (let y = 0; y < GRID; y++) {
    for (let u = 1; u <= LOW; u++) {
      let s = 0;
      for (let x = 0; x < GRID; x++) s += grid[y * GRID + x] * COS[u][x];
      rowsT[u][y] = s;
    }
  }

  const out = new Float64Array(LOW * LOW);
  for (let v = 1; v <= LOW; v++) {
    for (let u = 1; u <= LOW; u++) {
      let s = 0;
      for (let y = 0; y < GRID; y++) s += rowsT[u][y] * COS[v][y];
      out[(v - 1) * LOW + (u - 1)] = s;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: threshold at the median → 64-bit hash
// ---------------------------------------------------------------------------

/** Perceptual hash of decoded pixels, as 0x-prefixed hex (8 bytes = 16 hex chars). */
export function computePHash(img: RgbaImage): string {
  const coeffs = lowFrequencyDct(toGrayGrid(img));

  const sorted = Array.from(coeffs).sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;

  // A bit is set only if the coefficient is MEANINGFULLY above the median.
  // For a flat or near-flat image every coefficient is ~0, apart from
  // floating-point rounding crumbs (~1e-13), and without this tolerance those
  // crumbs would decide the bits at random. Real image coefficients are in the
  // tens to thousands, so 1e-6 never affects them.
  const EPSILON = 1e-6;

  let bits = BigInt(0);
  for (const c of coeffs) bits = (bits << BigInt(1)) | (c > median + EPSILON ? BigInt(1) : BigInt(0));
  return "0x" + bits.toString(16).padStart(16, "0");
}

/** Set bits in a 32-bit integer (the classic SWAR popcount: no loop, no BigInt). */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

/** A pHash as two 32-bit halves, so distances need no BigInt maths. */
export function phashWords(h: string): [number, number] {
  const hex = (h.startsWith("0x") ? h.slice(2) : h).padStart(16, "0").slice(-16);
  return [parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8), 16)];
}

/** Hamming distance between two pre-split pHashes (hot loops: live matching). */
export function wordDistance(a: [number, number], b: [number, number]): number {
  return popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]);
}

/** Number of differing bits between two pHashes (0–64). */
export function hammingDistance(a: string, b: string): number {
  return wordDistance(phashWords(a), phashWords(b));
}

/** Similarity as a percentage: 100% = identical hashes, ~50% = unrelated images. */
export function similarity(a: string, b: string): number {
  return Math.round((1 - hammingDistance(a, b) / 64) * 1000) / 10;
}

export function isPerceptualMatch(a: string, b: string, threshold = PHASH_MATCH_THRESHOLD): boolean {
  return hammingDistance(a, b) <= threshold;
}

// ---------------------------------------------------------------------------
// On-chain format: the contract stores pHash in a bytes32, left-aligned.
// ---------------------------------------------------------------------------

export function phashToBytes32(phash: string): string {
  if (!/^0x[0-9a-f]{16}$/i.test(phash)) throw new Error(`Not a 64-bit pHash: ${phash}`);
  return phash.toLowerCase() + "0".repeat(48);
}

export function bytes32ToPhash(bytes32: string): string {
  return bytes32.slice(0, 18).toLowerCase();
}

/*
 * Choosing the threshold
 * ----------------------
 * A threshold is a trade-off between two kinds of mistake:
 *   too low  → a WhatsApp-recompressed copy of a real photo is not recognised
 *              (it shows as UNVERIFIED instead of EDITED);
 *   too high → an unrelated photo is wrongly linked to someone's original.
 *
 * Important: the pHash match is not only for re-shared copies. It is also how
 * an EDITED photo is linked back to its original so the heatmap can be drawn.
 * So the threshold must tolerate real content edits, not just compression.
 *
 * Measured with `npm run phash:report` (8 generated scenes; distances in bits):
 *   recompress q30–q75, resize to 25–50%, WhatsApp-style   0
 *   brightness / contrast                                  0
 *   saturation / grayscale filters                         up to 14
 *   pasted object (5% / 12% of area), caption text         typically 4–18
 *   crop 8% per side                                       12–26  (pHash's known weak spot)
 *   mirrored image                                         30–36  (treated as a new image)
 *   UNRELATED images                                       22–38, mean ~31
 *
 * 16 keeps every benign variant and most realistic edits, while staying 6+
 * bits below the closest unrelated pair. For truly random 64-bit hashes, the
 * odds of two unrelated images landing within 16 bits are about 1 in 26,000.
 *
 * A false match is not trusted blindly either. In Phase 3 the verifier compares
 * the actual pixels against the stored original, and a candidate that differs
 * almost everywhere is rejected as "not a derivative" (→ UNVERIFIED).
 */
