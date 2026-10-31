// GET /api/feed: recent registrations for the Chain Explorer.
//   ?limit=20        page size (max 100)
//   ?before=<index>  older page (registration index to start below)
//   ?q=<query>       search by SHA-256 / tx hash prefix, or block number
import { connection } from "next/server";
import { errorResponse } from "@/lib/server/errors";
import { getIndex, syncIndex } from "@/lib/server/image-index";

export async function GET(request: Request) {
  await connection();
  try {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const before = url.searchParams.get("before");
    const q = url.searchParams.get("q");

    await syncIndex(); // pick up registrations made by anyone, not just this server
    const index = getIndex();
    const items = q ? index.search(q, limit) : index.recent(limit, before === null ? undefined : Number(before));
    return Response.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
