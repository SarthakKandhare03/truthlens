// GET /api/stats: live counters ("images secured", "blocks written", "edits tracked").
// The landing page renders them on the server, then polls this route to tick up live.
import { connection } from "next/server";
import { errorResponse } from "@/lib/server/errors";
import { getStats } from "@/lib/server/stats";

export async function GET() {
  await connection();
  try {
    return Response.json(await getStats());
  } catch (err) {
    return errorResponse(err);
  }
}
