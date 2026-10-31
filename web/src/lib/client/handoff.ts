// Passes a just-captured photo from the Capture page to the Verify page.
//
// Next.js client-side navigation keeps JavaScript modules alive, so a plain
// module variable survives the page change. No upload, no storage quota.
// A full page reload clears it, which is fine: it is a convenience only.
let pending: File | null = null;

export function handOffToVerify(file: File): void {
  pending = file;
}

/** Returns the pending file once, then forgets it. */
export function takeHandOff(): File | null {
  const file = pending;
  pending = null;
  return file;
}
