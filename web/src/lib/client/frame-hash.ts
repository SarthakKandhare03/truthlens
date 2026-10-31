"use client";

// Live verify, in the browser: turns the current camera frame into the
// perceptual hashes that /api/match compares. Only these 64-bit hashes are
// sent; the frame itself never leaves the device.
//
//   1. copy the guide area of the video into a small canvas (FRAME_W wide)
//   2. for each warp in WARPS (a small tilt, or the slant of a photo filmed
//      at an angle), draw it un-warped about the centre and read the pixels once
//   3. for both photo shapes in ASPECTS and every crop in SEARCH_GRID,
//      box-average the crop to a 64-px thumbnail and hash it (computePHash,
//      the same function the server uses)
//
// 450 hashes take a few milliseconds: the thumbnails are tiny, and the costly
// part (reading pixels back from the GPU) happens only 5 times per frame.
import { computePHash } from "@/lib/crypto/phash";
import { ASPECTS, boxThumb, cropRect, frameLight, SEARCH_GRID, WARPS, warpKey } from "@/lib/live-match";

export type Shape = "landscape" | "portrait";

/** The guide box, as fractions of the video frame (centred). */
export function guideBox(shape: Shape, vw: number, vh: number): { x: number; y: number; w: number; h: number } {
  const aspect = shape === "landscape" ? 4 / 3 : 3 / 4;
  let w = vw * 0.84;
  let h = w / aspect;
  if (h > vh * 0.84) {
    h = vh * 0.84;
    w = h * aspect;
  }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

const FRAME_LONG = 320; // long side of the working canvas

export type FrameHashes = { hashes: string[]; mean: number; contrast: number };

export class FrameHasher {
  private readonly base = document.createElement("canvas");
  private readonly turned = document.createElement("canvas");

  hash(video: HTMLVideoElement, shape: Shape): FrameHashes | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const g = guideBox(shape, vw, vh);
    const w = shape === "landscape" ? FRAME_LONG : Math.round((FRAME_LONG * 3) / 4);
    const h = shape === "landscape" ? Math.round((FRAME_LONG * 3) / 4) : FRAME_LONG;
    for (const c of [this.base, this.turned]) {
      c.width = w;
      c.height = h;
    }
    const bctx = this.base.getContext("2d", { willReadFrequently: true });
    const tctx = this.turned.getContext("2d", { willReadFrequently: true });
    if (!bctx || !tctx) return null;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(video, g.x, g.y, g.w, g.h, 0, 0, w, h);

    const byWarp = new Map<string, ImageData>();
    for (const warp of WARPS) {
      tctx.fillStyle = "#181818";
      tctx.fillRect(0, 0, w, h);
      tctx.save();
      tctx.translate(w / 2, h / 2);
      tctx.rotate((-warp.rot * Math.PI) / 180); // undo a tilt of `rot` degrees
      tctx.transform(1, 0, -warp.shear, 1, 0, 0); // undo a slant x' = x + shear·y
      tctx.drawImage(this.base, -w / 2, -h / 2);
      tctx.restore();
      byWarp.set(warpKey(warp), tctx.getImageData(0, 0, w, h));
    }

    const upright = byWarp.get(warpKey({ rot: 0, shear: 0 }))!;
    const { mean, contrast } = frameLight(upright);
    const hashes = ASPECTS[shape].flatMap((aspect) =>
      SEARCH_GRID.map((c) => computePHash(boxThumb(byWarp.get(warpKey(c.warp))!, cropRect(c, w, h, aspect)))),
    );
    return { hashes, mean, contrast };
  }
}
