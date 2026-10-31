// POST /api/verify: is this image AUTHENTIC, EDITED or UNVERIFIED?
//
//   1. Exact match. SHA-256 of the upload → look it up ON-CHAIN.
//        found + proof checks pass  → AUTHENTIC
//        found + checks fail        → UNVERIFIED (SIGNATURE_INVALID), a red flag:
//                                     the stored proof has been tampered with
//   2. Perceptual match. Compute pHash → shortlist registered photos whose own
//      pHash, or one of their variant pHashes (mirror, rotations, crops; see
//      src/lib/image/derivative.ts), is close. Re-confirmed on-chain.
//   3. Confirm it really is a derivative. For each shortlisted candidate, load
//      the stored original, check that the ORIGINAL is genuinely signed, undo
//      any rotation/mirroring, find where a crop came from (alignment), and
//      diff the pixels:
//        alignment not trustworthy, or
//        changed >  NOT_A_DERIVATIVE_PERCENT → not a derivative, skip it
//        otherwise → EDITED, using the candidate with the LEAST change
//      Measured with `npm run benchmark`: see the README.
//   4. Nothing found → UNVERIFIED. This means "no provenance record", NOT
//      "proven fake". The UI copy must say so.
import "server-only";
import type { ChainRecord, VerifyResponse } from "../../api-types";
import { sha256Hex } from "../../crypto/hash";
import { computePHash, hammingDistance, PHASH_MATCH_THRESHOLD } from "../../crypto/phash";
import { checkCaptureProof } from "../../crypto/proof";
import { decodeImage } from "../../image/decode-node";
import { compareDerivative, VARIANT_SHORTLIST, type Geometry } from "../../image/derivative";
import { NOT_A_DERIVATIVE_PERCENT } from "../../image/diff";
import { findRegistrationTx, getChain, readRecord } from "../chain";
import type { Upload } from "../http";
import { getIndex, syncIndex } from "../image-index";
import { readFromStorage } from "../storage";
import { ensureVariants } from "../variants";
import { loadStoredProof } from "./stored-proof";

/** Below this % of changed pixels, an edited copy counts as "no visible change". */
const NO_VISIBLE_CHANGE_PERCENT = 1;

/** Fills in the registration tx hash from the index, or from event logs as a fallback. */
async function withTxHash(record: ChainRecord): Promise<ChainRecord> {
  const txHash = getIndex().get(record.sha256)?.txHash ?? (await findRegistrationTx(record.sha256));
  return { ...record, txHash };
}

export async function verifyImage(upload: Upload): Promise<VerifyResponse> {
  const { network } = await getChain();
  const sha256 = await sha256Hex(upload.bytes);

  // --- 1. Exact match on-chain ----------------------------------------------------
  const exact = await readRecord(sha256);
  if (exact) {
    const proof = await loadStoredProof(exact.storageURI);
    if (!proof) {
      return { verdict: "UNVERIFIED", sha256, pHash: exact.pHash, reason: "PROOF_MISSING", nearestDistance: 0, network };
    }
    const checks = await checkCaptureProof(upload.bytes, proof, exact);
    if (!checks.valid) {
      return { verdict: "UNVERIFIED", sha256, pHash: exact.pHash, reason: "SIGNATURE_INVALID", nearestDistance: 0, network };
    }
    return {
      verdict: "AUTHENTIC",
      sha256,
      record: await withTxHash(exact),
      checks,
      signer: { publicKey: proof.publicKey, keyHash: exact.signerKeyHash },
      network,
    };
  }

  // --- 2. Perceptual match -------------------------------------------------------
  await syncIndex();
  await ensureVariants();
  const index = getIndex();
  const pHash = computePHash(await decodeImage(upload.bytes));
  let rejectedAsNotDerivative = false;

  // The perceptual hash only SHORTLISTS candidates; the pixels decide. Several
  // registered photos can look alike (a burst of shots of the same scene), and
  // the one with the smallest pHash distance is not necessarily the one this
  // file was made from. So every shortlisted candidate is diffed, and the
  // original that explains the image with the LEAST change wins.
  let best: {
    original: ChainRecord;
    originalChecks: Awaited<ReturnType<typeof checkCaptureProof>>;
    distance: number;
    diff: NonNullable<Awaited<ReturnType<typeof compareDerivative>>>;
  } | null = null;

  for (const candidate of index.shortlistVariants(pHash, VARIANT_SHORTLIST, 4)) {
    // The index is only a cache: re-read the candidate from the chain.
    const original = await readRecord(candidate.sha256);
    if (!original) continue;
    // The plain whole-image comparison is only allowed when the copy's OWN
    // fingerprint matched the original's (the original pipeline's rule); a
    // match through a crop/mirror fingerprint must pass the alignment gate.
    const plainAllowed = hammingDistance(pHash, original.pHash) <= PHASH_MATCH_THRESHOLD;
    const distance = candidate.distance;

    // --- 3. Confirm with the stored original ----------------------------------
    const originalBytes = await readFromStorage(original.storageURI);
    const originalProof = await loadStoredProof(original.storageURI);
    if (!originalBytes || !originalProof) continue;

    // An "edit" of something that is not genuinely signed proves nothing.
    const originalChecks = await checkCaptureProof(originalBytes, originalProof, original);
    if (!originalChecks.valid) continue;

    const diff = await compareDerivative(originalBytes, upload.bytes, candidate.variant.orient, plainAllowed);
    // null: the alignment showed this is not the copy's original at all (it
    // only resembled a crop of it), so it says nothing about the copy.
    if (!diff) continue;
    if (diff.changedPercent > NOT_A_DERIVATIVE_PERCENT) {
      rejectedAsNotDerivative = true;
      continue;
    }
    if (!best || diff.changedPercent < best.diff.changedPercent) best = { original, originalChecks, distance, diff };
  }

  if (best) {
    const { original, originalChecks, distance, diff } = best;
    const editKind =
      diff.changedPercent >= NO_VISIBLE_CHANGE_PERCENT ? "modified" : diff.globalAdjustment ? "adjusted" : "reencoded";

    return {
      verdict: "EDITED",
      sha256,
      pHash,
      original: await withTxHash(original),
      originalUrl: `/api/images/${original.sha256}`,
      originalChecks,
      distance,
      similarity: Math.round((1 - distance / 64) * 1000) / 10,
      diff: {
        gridSize: diff.gridSize,
        grid: diff.grid,
        changedPercent: diff.changedPercent,
        changedCells: diff.changedCells,
        globalAdjustment: diff.globalAdjustment,
        alignment: diff.alignment,
        geometry: publicGeometry(diff.geometry),
      },
      editKind,
      network,
    };
  }

  // --- 4. No provenance ------------------------------------------------------------
  return {
    verdict: "UNVERIFIED",
    sha256,
    pHash,
    reason: rejectedAsNotDerivative ? "NOT_A_DERIVATIVE" : "NO_RECORD",
    nearestDistance: index.nearestDistance(pHash),
    network,
  };
}

/** The part of the alignment result the UI needs (null for a plain, uncropped copy). */
function publicGeometry(g: Geometry) {
  if (!g.cropped && !g.mirrored && g.rotation === 0) return null;
  return { rect: g.rect, rotation: g.rotation, mirrored: g.mirrored, cropped: g.cropped, keptPercent: g.keptPercent };
}
