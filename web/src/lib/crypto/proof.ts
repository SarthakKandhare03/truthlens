// High-level "capture proof": everything that ties a photo to a device.
//
//   createCaptureProof()   runs on the capture page, right after the shutter
//   checkCaptureProof()    runs on the server, before registering, and again
//                          whenever someone verifies an image
//
// The server never trusts what the client claims. It re-hashes the bytes it
// actually received and recomputes the perceptual hash itself (see
// src/lib/image/decode-node.ts), so a malicious client cannot, for example,
// submit a fake pHash to get linked to somebody else's photo.
import { sha256Hex } from "./hash";
import { computePHash, type RgbaImage } from "./phash";
import { publicKeyFingerprint, signImageHash, verifyImageSignature } from "./signing";
import type { DeviceIdentity } from "./device-key-store";

export type CaptureProof = {
  sha256: string; // exact-bytes fingerprint (on-chain key)
  pHash: string; // 64-bit perceptual hash
  publicKey: string; // device public key (65 bytes hex)
  signerKeyHash: string; // sha256(publicKey), on-chain
  signature: string; // ECDSA P-256 over captureMessage(sha256)
};

type Signer = Pick<DeviceIdentity, "privateKey" | "publicKeyHex" | "keyFingerprint">;

export async function createCaptureProof(
  imageBytes: ArrayBuffer | ArrayBufferView,
  pixels: RgbaImage,
  signer: Signer,
): Promise<CaptureProof> {
  const sha256 = await sha256Hex(imageBytes);
  return {
    sha256,
    pHash: computePHash(pixels),
    publicKey: signer.publicKeyHex,
    signerKeyHash: signer.keyFingerprint,
    signature: await signImageHash(signer.privateKey, sha256),
  };
}

/** Each check is reported separately so the UI can show exactly what passed. */
export type ProofCheck = {
  hashMatchesBytes: boolean; // sha256(bytes) equals the claimed / on-chain hash
  keyMatchesFingerprint: boolean; // sha256(publicKey) equals signerKeyHash
  signatureValid: boolean; // ECDSA signature verifies over the hash
  valid: boolean; // all of the above
};

/**
 * Verify a proof against the actual image bytes.
 * `expected` holds the trusted values, normally read from the blockchain:
 * the registered sha256 and signerKeyHash.
 */
export async function checkCaptureProof(
  imageBytes: ArrayBuffer | ArrayBufferView,
  proof: Pick<CaptureProof, "publicKey" | "signature">,
  expected: { sha256: string; signerKeyHash: string },
): Promise<ProofCheck> {
  const actualHash = await sha256Hex(imageBytes);
  const hashMatchesBytes = actualHash === expected.sha256.toLowerCase();

  let keyMatchesFingerprint = false;
  try {
    keyMatchesFingerprint =
      (await publicKeyFingerprint(proof.publicKey)) === expected.signerKeyHash.toLowerCase();
  } catch {
    keyMatchesFingerprint = false; // malformed public key
  }

  // Verify over the hash of the bytes we actually have, not a claimed hash.
  const signatureValid = await verifyImageSignature(proof.publicKey, actualHash, proof.signature);

  return {
    hashMatchesBytes,
    keyMatchesFingerprint,
    signatureValid,
    valid: hashMatchesBytes && keyMatchesFingerprint && signatureValid,
  };
}
