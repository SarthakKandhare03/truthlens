// GET /api/images/:sha256: the stored ORIGINAL of a registered image.
//   ?w=160|320|640   a resized WebP thumbnail instead (explorer, timeline)
//
// Used by the before/after slider (full original) and by the explorer and
// timeline (thumbnails). The file is addressed by its own SHA-256, so the
// content at this URL can never change and browsers may cache it forever.
//
// Only three thumbnail widths are allowed: arbitrary sizes would let anyone
// make the server burn CPU resizing images to thousands of variants.
import { connection } from "next/server";
import sharp from "sharp";
import { isHexOfLength } from "@/lib/crypto/encoding";
import { MAX_INPUT_PIXELS } from "@/lib/image/decode-node";
import { readRecord } from "@/lib/server/chain";
import { errorResponse, ServiceError } from "@/lib/server/errors";
import { readFromStorage } from "@/lib/server/storage";
import { loadStoredProof } from "@/lib/server/services/stored-proof";

const THUMB_WIDTHS = new Set([160, 320, 640]);
const IMMUTABLE = "public, max-age=31536000, immutable";

export async function GET(request: Request, ctx: RouteContext<"/api/images/[sha256]">) {
  await connection(); // always run per request, never prerender at build time
  try {
    const sha256 = (await ctx.params).sha256.toLowerCase();
    if (!isHexOfLength(sha256, 32)) throw new ServiceError(400, "BAD_HASH", "Expected a 0x-prefixed SHA-256");

    const w = new URL(request.url).searchParams.get("w");
    const width = w === null ? null : Number(w);
    if (width !== null && !THUMB_WIDTHS.has(width)) {
      throw new ServiceError(400, "BAD_WIDTH", "w must be 160, 320 or 640");
    }

    const record = await readRecord(sha256);
    if (!record) throw new ServiceError(404, "NOT_REGISTERED", "No on-chain record for this hash");
    const bytes = await readFromStorage(record.storageURI);
    if (!bytes) throw new ServiceError(404, "ORIGINAL_MISSING", "The original file is not in storage");

    if (width !== null) {
      const thumb = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      return new Response(new Uint8Array(thumb), {
        headers: { "Content-Type": "image/webp", "Cache-Control": IMMUTABLE, "X-Content-Type-Options": "nosniff" },
      });
    }

    const proof = await loadStoredProof(record.storageURI);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": proof?.mime ?? "application/octet-stream",
        "Cache-Control": IMMUTABLE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
