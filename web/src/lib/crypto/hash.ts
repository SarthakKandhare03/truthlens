// SHA-256: the cryptographic fingerprint of the EXACT image bytes.
//
// Changing even one bit of the file gives a completely different hash, and
// finding two files with the same hash is computationally infeasible. That makes
// it the primary key on-chain: an exact match means "these are precisely the
// bytes that were captured and signed".
//
// The flip side is that SHA-256 cannot recognise a resized or recompressed copy.
// That job belongs to the perceptual hash in phash.ts.
//
// Uses the Web Crypto API, which exists in browsers and in Node 20+ (as
// globalThis.crypto), so the same code runs on the capture page and in the API.
import { bytesToHex, toBytes } from "./encoding";

/** SHA-256 of `data`, as 0x-prefixed hex (32 bytes, the same as a Solidity bytes32). */
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(data));
  return bytesToHex(new Uint8Array(digest));
}
