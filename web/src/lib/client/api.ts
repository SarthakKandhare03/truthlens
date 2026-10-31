// Typed browser-side calls to the TruthLens API (see src/app/api/).
import type { ApiError as ApiErrorBody, MatchResponse, RegisterResponse, VerifyResponse } from "../api-types";

/** An API failure with the server's machine-readable code (e.g. "SIGNATURE_INVALID"). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function postForm<T>(url: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the TruthLens server. Check your connection.");
  }
  const body = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export function registerPhoto(args: {
  photo: Blob;
  publicKey: string;
  signature: string;
  sha256: string;
}): Promise<RegisterResponse> {
  const form = new FormData();
  form.set("image", args.photo, "capture.jpg");
  form.set("publicKey", args.publicKey);
  form.set("signature", args.signature);
  form.set("sha256", args.sha256);
  return postForm("/api/register", form);
}

export function verifyPhoto(file: Blob): Promise<VerifyResponse> {
  const form = new FormData();
  form.set("image", file, file instanceof File ? file.name : "upload.jpg");
  return postForm("/api/verify", form);
}

/** Live verify: perceptual hashes of one camera frame → the closest sealed photo. */
export async function matchFrame(hashes: string[], signal?: AbortSignal): Promise<MatchResponse> {
  const res = await fetch("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashes }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as MatchResponse | ApiErrorBody | null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? `Request failed (${res.status})`);
  }
  return body as MatchResponse;
}
