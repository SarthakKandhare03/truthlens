// POST /api/register: seal a freshly captured photo on the blockchain.
//
// The browser has already hashed the photo and signed the hash with its
// device key. The server trusts none of that blindly:
//
//   1. Re-hash the bytes it actually received (and compare with the client's
//      hash, if sent, to detect corruption in transit).
//   2. Verify the ECDSA signature over that hash, so only a holder of the
//      device key could have produced this request.
//   3. Refuse duplicates BEFORE spending gas.
//   4. Compute the perceptual hash itself (a client could lie about it).
//   5. Store the original + proof, THEN write the chain record.
//      Storage first: if the transaction fails we are left with a harmless,
//      content-addressed orphan file. The other way round could leave a
//      permanent on-chain record pointing at a file that does not exist.
//   6. Optionally link it as an edit of an earlier registered image.
import "server-only";
import type { RegisterResponse } from "../../api-types";
import { isHexOfLength } from "../../crypto/encoding";
import { sha256Hex } from "../../crypto/hash";
import { computePHash, phashToBytes32 } from "../../crypto/phash";
import { publicKeyFingerprint, verifyImageSignature } from "../../crypto/signing";
import { decodeImage } from "../../image/decode-node";
import { explorerTxUrl, getChain, readRecord, recordEditOnChain, registerOnChain } from "../chain";
import { ServiceError } from "../errors";
import type { Upload } from "../http";
import { getIndex } from "../image-index";
import { ensureVariants } from "../variants";
import { storageKeys, writeStorage } from "../storage";
import type { StoredProof } from "./stored-proof";

export type RegisterInput = {
  upload: Upload;
  publicKey: string;
  signature: string;
  /** The hash the browser computed. Optional, used as an integrity check. */
  claimedSha256?: string | null;
  /** Register this image as an edit of an existing one. */
  parentHash?: string | null;
};

const now = () => performance.now();

export async function registerCapture(input: RegisterInput): Promise<RegisterResponse> {
  const { upload, publicKey, signature } = input;
  const claimed = input.claimedSha256?.toLowerCase() || null;
  const parentHash = input.parentHash?.toLowerCase() || null;

  // --- Validate the shape of the inputs ---------------------------------------
  if (!isHexOfLength(publicKey, 65)) throw new ServiceError(400, "BAD_PUBLIC_KEY", "publicKey must be 65 bytes of 0x-hex");
  if (!isHexOfLength(signature, 64)) throw new ServiceError(400, "BAD_SIGNATURE", "signature must be 64 bytes of 0x-hex");
  if (claimed && !isHexOfLength(claimed, 32)) throw new ServiceError(400, "BAD_HASH", "sha256 must be 32 bytes of 0x-hex");
  if (parentHash && !isHexOfLength(parentHash, 32)) throw new ServiceError(400, "BAD_PARENT", "parentHash must be 32 bytes of 0x-hex");

  const { network } = await getChain();

  // --- 1 + 2. Hash and verify the signature -------------------------------------
  let t = now();
  const sha256 = await sha256Hex(upload.bytes);
  if (claimed && claimed !== sha256) {
    throw new ServiceError(400, "HASH_MISMATCH", "The uploaded bytes do not match the hash the device signed");
  }
  if (!(await verifyImageSignature(publicKey, sha256, signature))) {
    throw new ServiceError(400, "SIGNATURE_INVALID", "The signature does not match this image and public key");
  }
  const verifySignature = now() - t;

  // --- 3. Duplicates and parent, checked against the chain before paying gas ----
  const existing = await readRecord(sha256);
  if (existing) {
    throw new ServiceError(409, "ALREADY_REGISTERED", "This exact image is already registered", { record: existing });
  }
  if (parentHash && !(await readRecord(parentHash))) {
    throw new ServiceError(404, "PARENT_NOT_REGISTERED", "The parent image is not registered");
  }

  // --- 4. Perceptual hash, computed by the server -------------------------------
  t = now();
  const pHash = computePHash(await decodeImage(upload.bytes));
  const signerKeyHash = await publicKeyFingerprint(publicKey);
  const perceptualHash = now() - t;

  // --- 5a. Store original + proof ---------------------------------------------
  t = now();
  const storage = writeStorage();
  const keys = storageKeys(sha256, upload.ext);
  const storageURI = await storage.put(keys.image, upload.bytes, upload.mime);
  const proof: StoredProof = {
    version: 1,
    sha256,
    pHash,
    publicKey,
    signature,
    signerKeyHash,
    mime: upload.mime,
    width: upload.width,
    height: upload.height,
    sizeBytes: upload.bytes.length,
    registeredAt: new Date().toISOString(),
  };
  await storage.put(keys.proof, new TextEncoder().encode(JSON.stringify(proof, null, 2)), "application/json");
  const storageMs = now() - t;

  // --- 5b. Write the chain record -----------------------------------------------
  t = now();
  const tx = await registerOnChain({ sha256, pHashBytes32: phashToBytes32(pHash), signerKeyHash, storageURI });

  // --- 6. Optional edit link -----------------------------------------------------
  // The image is already sealed at this point. If only the link fails, report
  // that honestly instead of failing the whole request with a misleading 500.
  let editTxHash: string | null = null;
  let editLinkError: string | null = null;
  if (parentHash) {
    try {
      editTxHash = (await recordEditOnChain(parentHash, sha256)).txHash;
    } catch (err) {
      editLinkError = err instanceof Error ? err.message : String(err);
    }
  }
  const blockchain = now() - t;

  // Read the record back from the chain: the response shows what is actually
  // on-chain (with the chain's own timestamp), not what we hoped to write.
  const record = await readRecord(sha256);
  if (!record) throw new ServiceError(500, "REGISTRATION_NOT_FOUND", "Transaction mined but record not found");
  record.txHash = tx.txHash;
  getIndex().upsert(record);
  // Precompute this photo's crop/mirror fingerprints in the background, so the
  // first verification of an edited copy doesn't have to wait for them.
  void ensureVariants().catch(() => undefined);

  const ms = (x: number) => Math.round(x);
  return {
    record,
    txHash: tx.txHash,
    editTxHash,
    editLinkError,
    explorerUrl: explorerTxUrl(network.chainId, tx.txHash),
    timings: {
      verifySignature: ms(verifySignature),
      perceptualHash: ms(perceptualHash),
      storage: ms(storageMs),
      blockchain: ms(blockchain),
    },
  };
}
