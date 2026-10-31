// The signature proof saved next to every original (originals/<sha>/proof.json).
//
// It holds the full public key and the signature, which are deliberately kept
// off-chain (see TruthRegistry.sol). It cannot be forged usefully: the
// verifier checks sha256(publicKey) against the on-chain signerKeyHash and
// the signature against the actual image bytes.
import "server-only";
import { isHexOfLength } from "../../crypto/encoding";
import { proofUriFor, readFromStorage } from "../storage";

export type StoredProof = {
  version: 1;
  sha256: string;
  pHash: string;
  publicKey: string;
  signature: string;
  signerKeyHash: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  registeredAt: string;
};

export async function loadStoredProof(imageUri: string): Promise<StoredProof | null> {
  const bytes = await readFromStorage(proofUriFor(imageUri));
  if (!bytes) return null;
  try {
    const proof = JSON.parse(new TextDecoder().decode(bytes)) as StoredProof;
    // Shape check only. Whether the values are TRUE is decided by checkCaptureProof.
    if (!isHexOfLength(proof.publicKey, 65) || !isHexOfLength(proof.signature, 64)) return null;
    return proof;
  } catch {
    return null;
  }
}
