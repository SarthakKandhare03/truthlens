// One error type for every expected failure, so each API route answers with
// the same JSON shape:  { "error": { "code": "...", "message": "..." } }
// The frontend switches on `code`, and the human-readable `message` can be shown as is.
import "server-only";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Converts any thrown value into a JSON Response. Unexpected errors become a generic 500. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return Response.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }

  // A stopped Hardhat node is the most common problem in development, so give a clear hint.
  const text = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|failed to detect network|connect ECONNREFUSED/i.test(text)) {
    return Response.json(
      { error: { code: "CHAIN_UNREACHABLE", message: "Cannot reach the blockchain node. Is `npm run chain` running?" } },
      { status: 503 },
    );
  }

  console.error("[api] unexpected error", err);
  return Response.json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, { status: 500 });
}
