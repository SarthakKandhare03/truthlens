// Tamper heatmap: WHERE does a suspect image differ from its registered original?
//
// Runs after the perceptual hash has linked a suspect image to an original.
//
//   1. ALIGN      Resize both to the same working size (512 px wide, original's
//                 aspect ratio). A resized or WhatsApp'd copy lines up pixel for
//                 pixel with its original.
//   2. DENOISE    Convert to grayscale and blur slightly. JPEG recompression
//                 creates tiny block and ringing artefacts everywhere; the blur
//                 removes them, while real edits (objects, text, erasures) are
//                 far larger and survive.
//   3. NORMALISE  Estimate any WHOLE-image brightness/contrast filter as a
//                 straight line, original ≈ gain × suspect + offset, using
//                 robust fitting (see fitToneMapping). Undo it before comparing,
//                 so a filter is reported once as a "global adjustment" instead
//                 of lighting up 100% of the heatmap and hiding the local edits.
//   4. COMPARE    A pixel counts as changed if its brightness still differs by
//                 more than PIXEL_THRESHOLD (out of 255). Changed pixels are
//                 summarised on a 16×16 grid: each cell holds the fraction of
//                 its pixels that changed (0–1). The UI turns that into the
//                 amber/red overlay.
//
// Limits (documented in the README):
//   - Grayscale comparison: an edit that ONLY changes hue (red car → blue car
//     of the same brightness) is under-reported. Most tampering (pasting,
//     erasing, adding text) changes brightness.
//   - Crops change the framing, so pixels no longer line up and the heatmap
//     shows scattered change. A crop that changes the aspect ratio is flagged
//     as "approximate" alignment.
import "server-only";
import sharp from "sharp";
import { toBytes } from "../crypto/encoding";
import { MAX_INPUT_PIXELS } from "./decode-node";

export const GRID_SIZE = 16;
const WORK_WIDTH = 512;
const BLUR_SIGMA = 1.2;

/** Brightness difference (0–255) above which a pixel counts as modified.
 *  Measured with `npm run diff:report`; see the README table. */
export const PIXEL_THRESHOLD = 20;

/**
 * If more than this share of the image differs, the "match" was not really a
 * derivative of the original (a rare false perceptual-hash match). The
 * verifier then treats the image as UNVERIFIED rather than "95% edited".
 * Measured: unrelated images 53–59%, the largest genuine edit tested (an 8%
 * crop on each side) ≤ 31%. 45 sits between the two.
 */
export const NOT_A_DERIVATIVE_PERCENT = 45;

export type DiffResult = {
  gridSize: number; // 16
  /** GRID_SIZE² values, row-major, each the fraction (0–1) of the cell's pixels that changed. */
  grid: number[];
  /** Share of the whole image that changed, 0–100, one decimal. */
  changedPercent: number;
  /** Cells with at least 10% changed pixels (handy for the UI's summary). */
  changedCells: number;
  /** True if brightness/contrast of the whole image was shifted (a filter). */
  globalAdjustment: boolean;
  /** "exact": same size; "resized": same shape, different size;
   *  "approximate": different aspect ratio (cropped?), so the heatmap is less reliable. */
  alignment: "exact" | "resized" | "approximate";
  width: number; // working resolution used for the comparison
  height: number;
};

type Gray = Uint8Array;

async function toWorkingGray(bytes: Uint8Array, width: number, height: number): Promise<Gray> {
  const { data } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // honour EXIF orientation
    .resize(width, height, { fit: "fill" }) // force identical geometry
    .grayscale()
    .blur(BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Value below which a fraction `q` of the pixels fall (via a 256-bin histogram). */
function quantile(data: Gray, q: number): number {
  const hist = new Uint32Array(256);
  for (const v of data) hist[v] += 1;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= q * data.length) return v;
  }
  return 255;
}

/**
 * Finds gain and offset so that  original ≈ gain × suspect + offset.
 *
 * Plain least squares would be pulled off course by the edited pixels
 * themselves. So:
 *   1. Start from a ROBUST estimate: match the medians and interquartile
 *      ranges of the two images. Quantiles barely move unless more than
 *      about a quarter of the image was changed.
 *   2. Refine with least squares, each time using only the pixels that agree
 *      with the current fit ("inliers").
 * Untouched pixels, usually the vast majority, then determine the global
 * filter, and local edits are left out as outliers, which is exactly what we
 * want to highlight.
 */
export function fitToneMapping(original: Gray, suspect: Gray): { gain: number; offset: number } {
  const clampGain = (g: number) => Math.min(2, Math.max(0.5, g));

  // 1. Robust starting point from quantiles.
  const iqrO = Math.max(quantile(original, 0.75) - quantile(original, 0.25), 1);
  const iqrS = Math.max(quantile(suspect, 0.75) - quantile(suspect, 0.25), 1);
  let gain = clampGain(iqrO / iqrS);
  let offset = quantile(original, 0.5) - gain * quantile(suspect, 0.5);
  let inlierLimit = PIXEL_THRESHOLD * 3; // generous at first, then tighter

  // 2. Refine on inliers.
  for (let pass = 0; pass < 6; pass++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < original.length; i++) {
      const x = suspect[i];
      const y = original[i];
      if (Math.abs(y - (gain * x + offset)) > inlierLimit) continue;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    if (n < 100) break; // not enough agreement to fit anything meaningful
    const varX = sxx / n - (sx / n) ** 2;
    // Clamp to plausible photo filters, so a wildly different image cannot be
    // "explained away" by a degenerate mapping (e.g. gain 0 = flat grey).
    gain = varX < 1e-6 ? 1 : clampGain((sxy / n - (sx / n) * (sy / n)) / varX);
    offset = sy / n - gain * (sx / n);
    inlierLimit = PIXEL_THRESHOLD * 1.5;
  }
  return { gain, offset };
}

async function uprightSize(bytes: Uint8Array) {
  const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  // EXIF orientations 5–8 are rotated by 90°, which swaps width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  return { width: swap ? meta.height! : meta.width!, height: swap ? meta.width! : meta.height! };
}

export async function compareImages(
  originalBytes: ArrayBuffer | ArrayBufferView,
  suspectBytes: ArrayBuffer | ArrayBufferView,
): Promise<DiffResult> {
  const original = toBytes(originalBytes);
  const suspect = toBytes(suspectBytes);

  // --- 1. Align --------------------------------------------------------------
  const o = await uprightSize(original);
  const s = await uprightSize(suspect);
  const width = Math.min(WORK_WIDTH, o.width);
  const height = Math.max(1, Math.round((width * o.height) / o.width));

  const aspectDelta = Math.abs(o.width / o.height - s.width / s.height) / (o.width / o.height);
  const alignment: DiffResult["alignment"] =
    aspectDelta > 0.02 ? "approximate" : o.width === s.width && o.height === s.height ? "exact" : "resized";

  // --- 2. Denoise --------------------------------------------------------------
  const a = await toWorkingGray(original, width, height);
  const b = await toWorkingGray(suspect, width, height);

  // --- 3. Undo any global brightness/contrast filter ---------------------------
  const { gain, offset } = fitToneMapping(a, b);
  // How far a mid-grey pixel moves under the fitted mapping: a readable
  // measure of "was a filter applied?" that combines gain and offset.
  const midGreyShift = Math.abs(gain * 128 + offset - 128);
  const globalAdjustment = Math.abs(gain - 1) > 0.08 || midGreyShift > 6;

  // --- 4. Compare pixel by pixel, then summarise per grid cell -----------------
  const cellChanged = new Float64Array(GRID_SIZE * GRID_SIZE);
  const cellTotal = new Float64Array(GRID_SIZE * GRID_SIZE);
  let changed = 0;

  for (let y = 0; y < height; y++) {
    const rowCell = Math.floor((y * GRID_SIZE) / height) * GRID_SIZE;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const isChanged = Math.abs(a[i] - (gain * b[i] + offset)) > PIXEL_THRESHOLD;
      const cell = rowCell + Math.floor((x * GRID_SIZE) / width);
      cellTotal[cell] += 1;
      if (isChanged) {
        cellChanged[cell] += 1;
        changed += 1;
      }
    }
  }

  const grid = Array.from(cellChanged, (c, i) => Math.round((c / cellTotal[i]) * 1000) / 1000);
  return {
    gridSize: GRID_SIZE,
    grid,
    changedPercent: Math.round((changed / (width * height)) * 1000) / 10,
    changedCells: grid.filter((f) => f >= 0.1).length,
    globalAdjustment,
    alignment,
    width,
    height,
  };
}
