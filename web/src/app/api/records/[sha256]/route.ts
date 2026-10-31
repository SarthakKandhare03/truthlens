// GET /api/records/:sha256: provenance tree (original → edits) around an image.
import { connection } from "next/server";
import { isHexOfLength } from "@/lib/crypto/encoding";
import { errorResponse, ServiceError } from "@/lib/server/errors";
import { getProvenance } from "@/lib/server/services/provenance";

export async function GET(_request: Request, ctx: RouteContext<"/api/records/[sha256]">) {
  await connection();
  try {
    const sha256 = (await ctx.params).sha256.toLowerCase();
    if (!isHexOfLength(sha256, 32)) throw new ServiceError(400, "BAD_HASH", "Expected a 0x-prefixed SHA-256");
    return Response.json(await getProvenance(sha256));
  } catch (err) {
    return errorResponse(err);
  }
}
