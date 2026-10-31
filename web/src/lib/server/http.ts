// Small helpers shared by the API routes: reading uploads safely and rate limiting.
import "server-only";
import sharp, { type Metadata } from "sharp";
import { config } from "./config";
import { ServiceError } from "./errors";
import { MAX_INPUT_PIXELS } from "../image/decode-node";

/** Formats we accept, mapped to the file extension used in storage. */
const FORMATS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" },
  webp: { ext: "webp", mime: "image/webp" },
  avif: { ext: "avif", mime: "image/avif" },
  heif: { ext: "heic", mime: "image/heic" },
};

export type Upload = { bytes: Uint8Array; ext: string; mime: string; width: number; height: number };

/**
 * Reads an image file field from multipart form data.
 * The real format is detected from the file's CONTENT, never trusted from the
 * filename or the browser-supplied MIME type.
 */
export async function readImageUpload(form: FormData, field = "image"): Promise<Upload> {
  const file = form.get(field);
  if (!(file instanceof File)) throw new ServiceError(400, "NO_IMAGE", `Missing "${field}" file in the form data`);
  if (file.size === 0) throw new ServiceError(400, "EMPTY_FILE", "The uploaded file is empty");
  if (file.size > config.maxUploadBytes) {
    throw new ServiceError(413, "FILE_TOO_LARGE", `Images must be under ${config.maxUploadBytes / 1024 / 1024} MB`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ServiceError(415, "NOT_AN_IMAGE", "That file is not an image we can read");
  }
  const format = meta.format ? FORMATS[meta.format] : undefined;
  if (!format || !meta.width || !meta.height) {
    throw new ServiceError(415, "UNSUPPORTED_FORMAT", `Unsupported image format "${meta.format}". Use JPEG, PNG or WebP.`);
  }
  return { bytes, ...format, width: meta.width, height: meta.height };
}

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new ServiceError(400, "BAD_FORM", "Expected multipart/form-data");
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window, in memory)
// ---------------------------------------------------------------------------
//
// Each registration costs the relayer real gas on a public network, so an open
// endpoint could be used to drain the wallet. This per-IP limit is deliberately
// simple: it lives in this process's memory, so with several servers you
// would move it to Redis or put it at the edge (e.g. a CDN/WAF rule).

const hits = new Map<string, number[]>();

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export function enforceRateLimit(key: string, limitPerMinute: number, what = "registrations"): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limitPerMinute) {
    const retryAfter = Math.ceil((60_000 - (now - recent[0])) / 1000);
    throw new ServiceError(429, "RATE_LIMITED", `Too many ${what}. Try again in ${retryAfter}s.`, { retryAfter });
  }
  recent.push(now);
  hits.set(key, recent);
}
