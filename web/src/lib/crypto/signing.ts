// ECDSA P-256 device signatures via the Web Crypto API.
//
// Each device (browser) has its own key pair:
//   - The PRIVATE key is created as non-extractable. JavaScript (including any
//     malicious script injected into the page) can ask the browser to sign with
//     it, but can never read its bytes, so the key cannot be copied off the device.
//   - The PUBLIC key is shared freely. Its SHA-256 fingerprint goes on-chain as
//     `signerKeyHash`; the full key is stored next to the original image.
//
// What exactly is signed?
//   message = "TruthLens/capture/v1" ‖ 0x00 ‖ sha256(image bytes)
// The fixed prefix is "domain separation": a TruthLens signature can never be
// replayed as a signature over some other kind of data (or the other way
// round), and "v1" lets the format evolve later without ambiguity.
//
// Why P-256 and not secp256k1 (Ethereum's curve)? P-256 is the curve the Web
// Crypto API, phone secure enclaves and passkeys support natively, so the
// private key can stay inside the browser's key store.
//
// Signature format: Web Crypto produces 64 bytes, r ‖ s (IEEE P1363), with no
// DER wrapping. ECDSA signatures are malleable ((r, s) and (r, n−s) both
// verify). That is harmless here: signatures are never used as identifiers,
// only checked for validity.
import { sha256Hex } from "./hash";
import { bytesToHex, concatBytes, hexToBytes, isHexOfLength, utf8, type Bytes } from "./encoding";

export const SIGNATURE_DOMAIN = "TruthLens/capture/v1";

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

/** Uncompressed P-256 public key: 0x04 ‖ X (32 bytes) ‖ Y (32 bytes). */
export const PUBLIC_KEY_BYTES = 65;
export const SIGNATURE_BYTES = 64;

/** The exact bytes that get signed for an image with this SHA-256. */
export function captureMessage(sha256: string): Bytes {
  if (!isHexOfLength(sha256, 32)) throw new Error("sha256 must be 32 bytes of 0x-hex");
  return concatBytes(utf8(SIGNATURE_DOMAIN), new Uint8Array([0]), hexToBytes(sha256));
}

/**
 * New device key pair. `extractable: false` applies to the private key only;
 * Web Crypto always lets public keys be exported.
 */
export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);
}

/** Public key as 0x-hex of the 65-byte uncompressed point. */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
}

export async function importPublicKey(publicKeyHex: string): Promise<CryptoKey> {
  if (!isHexOfLength(publicKeyHex, PUBLIC_KEY_BYTES)) {
    throw new Error("Public key must be 65 bytes (uncompressed P-256) of 0x-hex");
  }
  return crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), ALGORITHM, true, ["verify"]);
}

/**
 * Fingerprint that goes on-chain as `signerKeyHash`: SHA-256 of the raw public
 * key bytes. The 65-byte key is too big to store cheaply; the 32-byte hash
 * commits to it just as firmly.
 */
export async function publicKeyFingerprint(publicKeyHex: string): Promise<string> {
  return sha256Hex(hexToBytes(publicKeyHex));
}

/** Sign an image's SHA-256 with the device's private key. Returns 64-byte 0x-hex. */
export async function signImageHash(privateKey: CryptoKey, sha256: string): Promise<string> {
  const sig = await crypto.subtle.sign(SIGN_PARAMS, privateKey, captureMessage(sha256));
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Check a signature. Never throws: malformed keys or signatures (which could
 * come from anyone calling the API) simply return false.
 */
export async function verifyImageSignature(
  publicKeyHex: string,
  sha256: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    if (!isHexOfLength(signatureHex, SIGNATURE_BYTES)) return false;
    const key = await importPublicKey(publicKeyHex);
    return await crypto.subtle.verify(SIGN_PARAMS, key, hexToBytes(signatureHex), captureMessage(sha256));
  } catch {
    return false;
  }
}
