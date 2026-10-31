// Server-side image decoding with sharp (libvips): file bytes → RGBA pixels.
//
// Used by the API to compute the authoritative perceptual hash and, in Phase 3,
// the tamper heatmap. sharp is native code and server-only; the browser
// equivalent is decode-browser.ts.
import "server-only";
import sharp from "sharp";
import type { RgbaImage } from "../crypto/phash";
import { toBytes } from "../crypto/encoding";

/**
 * Refuse images above 50 megapixels. A tiny, highly compressed file can
 * expand to gigabytes of pixels (a "decompression bomb"), so we cap it before
 * decoding. 50 MP is well above any phone camera.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

export async function decodeImage(bytes: ArrayBuffer | ArrayBufferView): Promise<RgbaImage> {
  const { data, info } = await sharp(toBytes(bytes), { limitInputPixels: MAX_INPUT_PIXELS })
    // Apply the EXIF orientation flag, so a portrait phone photo is hashed
    // upright, the same way a browser displays it.
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}
