// POST /api/match: live verify. The camera page hashes each frame in the
// browser (at many crops, see src/lib/live-match.ts) and sends ONLY those
// 64-bit perceptual hashes here, never the picture itself: a few hundred
// bytes per frame, and the photo never leaves the device.
//
//   body     { "hashes": ["0x0f3c…", …] }        1–500 hashes of 16 hex digits
//   reply    { "best": { sha256, distance } | null, "record": ChainRecord | null }
//
// `record` is filled only when the best distance is within LIVE_MATCH, so a
// far-off nearest neighbour is never presented as a match. The client still
// decides the final verdict over several frames (decide() in live-match.ts).
import { connection } from "next/server";
import { errorResponse, ServiceError } from "@/lib/server/errors";
import { clientIp, enforceRateLimit } from "@/lib/server/http";
import { getIndex, syncIndex } from "@/lib/server/image-index";
import { LIVE_MATCH } from "@/lib/live-match";

const HASH = /^0x[0-9a-f]{16}$/;
const MAX_HASHES = 500; // 2 photo shapes × 225 crops = 450 per frame
const PER_MINUTE = 600; // ~10 frames a second, far more than the client sends
const SYNC_EVERY_MS = 1000;

// Syncing costs one RPC call; at several frames a second, once a second is plenty.
let lastSync = 0;

export async function POST(request: Request) {
  await connection();
  try {
    enforceRateLimit(`match:${clientIp(request)}`, PER_MINUTE, "live checks");
    const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
    const hashes = body?.hashes;
    if (
      !Array.isArray(hashes) ||
      hashes.length === 0 ||
      hashes.length > MAX_HASHES ||
      !hashes.every((h) => typeof h === "string" && HASH.test(h.toLowerCase()))
    ) {
      throw new ServiceError(400, "BAD_HASHES", `Send 1–${MAX_HASHES} perceptual hashes as 0x + 16 hex digits`);
    }

    if (Date.now() - lastSync > SYNC_EVERY_MS) {
      lastSync = Date.now();
      await syncIndex();
    }
    const index = getIndex();
    const best = index.bestOf((hashes as string[]).map((h) => h.toLowerCase()));
    const record = best && best.distance <= LIVE_MATCH ? index.get(best.sha256) : null;
    return Response.json({ best, record });
  } catch (err) {
    return errorResponse(err);
  }
}
