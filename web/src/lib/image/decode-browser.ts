// Browser-side image decoding: Blob/File → RGBA pixels via a canvas.
//
// The capture page uses this to show the perceptual hash in its animation.
// The server always recomputes the pHash itself from the uploaded bytes (with
// sharp), so tiny decoder differences between browsers cannot affect the
// verdict.
import type { RgbaImage } from "../crypto/phash";

export async function decodeImageInBrowser(blob: Blob): Promise<RgbaImage> {
  // "from-image" applies EXIF orientation, matching sharp's .rotate() on the server.
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const { width, height } = bitmap;
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}
