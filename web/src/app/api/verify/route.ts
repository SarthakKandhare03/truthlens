// POST /api/verify   (multipart/form-data)
//   image   any image file
// → 200 VerifyResponse (AUTHENTIC | EDITED | UNVERIFIED) | 4xx/5xx { error }
//
// Verification only READS the chain. It needs no wallet and costs no gas,
// which is why anyone can verify any photo.
import { errorResponse } from "@/lib/server/errors";
import { readForm, readImageUpload } from "@/lib/server/http";
import { verifyImage } from "@/lib/server/services/verify";

export async function POST(request: Request) {
  try {
    const form = await readForm(request);
    return Response.json(await verifyImage(await readImageUpload(form)));
  } catch (err) {
    return errorResponse(err);
  }
}
