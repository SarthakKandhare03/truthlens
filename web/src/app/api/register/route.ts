// POST /api/register   (multipart/form-data)
//   image       the captured photo (JPEG/PNG/WebP)
//   publicKey   device public key, 0x-hex (65 bytes)
//   signature   ECDSA signature, 0x-hex (64 bytes)
//   sha256      optional: the hash the device signed (integrity check)
//   parentHash  optional: register as an edit of this image
// → 201 RegisterResponse | 4xx/5xx { error }
import { errorResponse } from "@/lib/server/errors";
import { config } from "@/lib/server/config";
import { clientIp, enforceRateLimit, readForm, readImageUpload } from "@/lib/server/http";
import { registerCapture } from "@/lib/server/services/register";

export async function POST(request: Request) {
  try {
    enforceRateLimit(`register:${clientIp(request)}`, config.registerRateLimitPerMinute);
    const form = await readForm(request);
    const result = await registerCapture({
      upload: await readImageUpload(form),
      publicKey: String(form.get("publicKey") ?? ""),
      signature: String(form.get("signature") ?? ""),
      claimedSha256: form.get("sha256")?.toString() ?? null,
      parentHash: form.get("parentHash")?.toString() ?? null,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
