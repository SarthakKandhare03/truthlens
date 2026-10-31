// GET /api/records/:sha256: the full provenance tree around an image.
//
// Walks UP the parent links to the original capture, then DOWN through every
// recorded edit (breadth-first). The Phase 5 timeline renders this:
//   Captured → Registered on block #N → Edited version → …
// Everything is read from the chain itself, not the cache.
import "server-only";
import type { ChainRecord, ProvenanceNode, ProvenanceResponse } from "../../api-types";
import { findRegistrationTx, getChain, readEdits, readRecord } from "../chain";
import { ServiceError } from "../errors";
import { getIndex } from "../image-index";

const MAX_DEPTH = 32; // guards against unexpectedly long chains
const MAX_NODES = 64;

async function mustRead(sha256: string): Promise<ChainRecord> {
  const rec = await readRecord(sha256);
  if (!rec) throw new ServiceError(404, "NOT_REGISTERED", "No on-chain record for this hash");
  return rec;
}

export async function getProvenance(sha256: string): Promise<ProvenanceResponse> {
  const { network } = await getChain();
  const focus = sha256.toLowerCase();

  // Up: follow parentHash to the root (the original capture).
  let root = await mustRead(focus);
  for (let i = 0; root.parentHash && i < MAX_DEPTH; i++) root = await mustRead(root.parentHash);

  // Down: breadth-first through recorded edits.
  const nodes: ProvenanceNode[] = [];
  const queue: { sha: string; depth: number }[] = [{ sha: root.sha256, depth: 0 }];
  while (queue.length && nodes.length < MAX_NODES) {
    const { sha, depth } = queue.shift()!;
    const record = sha === root.sha256 ? root : await mustRead(sha);
    const children = await readEdits(sha);
    const txHash = getIndex().get(sha)?.txHash ?? (await findRegistrationTx(sha));
    nodes.push({ ...record, txHash, depth, children });
    for (const child of children) queue.push({ sha: child, depth: depth + 1 });
  }

  return { root: root.sha256, focus, nodes, network };
}
