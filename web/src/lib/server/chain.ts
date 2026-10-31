// Talks to the TruthRegistry contract with ethers.js.
//
// Reading (verification, explorer) needs no wallet: anyone can read a public
// blockchain. Writing (registration) goes through the RELAYER wallet, a
// server-side key that pays the gas, so users never need MetaMask or crypto.
//
// The SQLite index (index-db.ts) is only a cache. Every verdict that matters
// is checked against the chain itself through this module.
import "server-only";
import { Contract, JsonRpcProvider, NonceManager, Wallet, type Log } from "ethers";
import type { ChainRecord, NetworkInfo } from "../api-types";
import { bytes32ToPhash } from "../crypto/phash";
import { loadDeployment, type Deployment } from "../chain/deployment";
import { config } from "./config";
import { ServiceError } from "./errors";

const ZERO = "0x" + "0".repeat(64);

type Chain = {
  deployment: Deployment;
  provider: JsonRpcProvider;
  reader: Contract;
  network: NetworkInfo;
};

let cached: { key: string; chain: Chain } | null = null;

/** Contract handle for the configured network, rebuilt if the deployment changes. */
export async function getChain(): Promise<Chain> {
  const deployment = await loadDeployment();
  if (!deployment) {
    throw new ServiceError(
      503,
      "CONTRACT_NOT_DEPLOYED",
      `No deployment for "${config.chainNetwork}". Run \`npm run deploy:local\` (with \`npm run chain\` running).`,
    );
  }
  // deployedAt is part of the key on purpose: restarting the local Hardhat
  // node and redeploying gives the SAME address and tx hash, but a fresh chain
  // whose nonces start again from zero. A stale wallet would send the wrong nonce.
  const key = `${config.rpcUrl}|${deployment.address}|${deployment.txHash}|${deployment.deployedAt}`;
  if (cached?.key === key) return cached.chain;

  // staticNetwork: trust the chain id from the deployment file instead of
  // asking the node on every request (fewer round-trips, clearer errors).
  // cacheTimeout -1: ethers normally re-uses identical answers for 250 ms. A
  // provenance service must never act on stale chain data (it also caused
  // a stale nonce right after a transaction).
  const provider = new JsonRpcProvider(config.rpcUrl, deployment.chainId, {
    staticNetwork: true,
    cacheTimeout: -1,
  });
  const chain: Chain = {
    deployment,
    provider,
    reader: new Contract(deployment.address, deployment.abi as never, provider),
    network: { name: deployment.network, chainId: deployment.chainId, contract: deployment.address },
  };
  cached = { key, chain };
  writer = null;
  return chain;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type RawRecord = {
  sha256Hash: string;
  pHash: string;
  signerKeyHash: string;
  storageURI: string;
  registrar: string;
  timestamp: bigint;
  blockNumber: bigint;
  index: bigint;
  parentHash: string;
};

function toRecord(raw: RawRecord, txHash: string | null = null): ChainRecord {
  return {
    sha256: raw.sha256Hash.toLowerCase(),
    pHash: bytes32ToPhash(raw.pHash),
    signerKeyHash: raw.signerKeyHash.toLowerCase(),
    storageURI: raw.storageURI,
    registrar: raw.registrar,
    timestamp: Number(raw.timestamp),
    blockNumber: Number(raw.blockNumber),
    index: Number(raw.index),
    parentHash: raw.parentHash === ZERO ? null : raw.parentHash.toLowerCase(),
    txHash,
  };
}

/** The on-chain record for an exact SHA-256, or null if it was never registered. */
export async function readRecord(sha256: string): Promise<ChainRecord | null> {
  const { reader } = await getChain();
  const raw = (await reader.getRecord(sha256)) as RawRecord;
  return raw.timestamp === BigInt(0) ? null : toRecord(raw);
}

export async function readEdits(sha256: string): Promise<string[]> {
  const { reader } = await getChain();
  return ((await reader.getEdits(sha256)) as string[]).map((h) => h.toLowerCase());
}

export async function readTotalRecords(): Promise<number> {
  const { reader } = await getChain();
  return Number(await reader.totalRecords());
}

export async function readHashPage(start: number, count: number): Promise<string[]> {
  const { reader } = await getChain();
  return ((await reader.getHashes(start, count)) as string[]).map((h) => h.toLowerCase());
}

export async function readHashAt(index: number): Promise<string> {
  const { reader } = await getChain();
  return ((await reader.hashAt(index)) as string).toLowerCase();
}

/**
 * Finds the registration transaction of a hash via the indexed event topic.
 * Best effort: public RPCs may refuse wide log queries, in which case the
 * record is still valid, just shown without its tx hash.
 */
export async function findRegistrationTx(sha256: string): Promise<string | null> {
  try {
    const { reader, deployment } = await getChain();
    const logs = (await reader.queryFilter(reader.filters.ImageRegistered(sha256), deployment.deployBlock)) as Log[];
    return logs[0]?.transactionHash ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes (relayer)
// ---------------------------------------------------------------------------

let writer: Contract | null = null;

async function getWriter(): Promise<Contract> {
  const chain = await getChain();
  if (!writer) {
    // NonceManager tracks the next transaction number locally, so back-to-back
    // transactions do not both grab the same nonce from the node.
    const wallet = new NonceManager(new Wallet(config.relayerPrivateKey(chain.network.chainId), chain.provider));
    writer = new Contract(chain.deployment.address, chain.deployment.abi as never, wallet);
  }
  return writer;
}

// All writes run one after another. Two registrations at the same moment would
// otherwise race for nonces and one would be rejected by the node.
let txQueue: Promise<unknown> = Promise.resolve();
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = txQueue.then(fn, fn);
  txQueue = run.catch(() => undefined);
  return run;
}

export type TxResult = { txHash: string; blockNumber: number };

const isStaleNonce = (err: unknown) => (err as { code?: string })?.code === "NONCE_EXPIRED";

/**
 * Sends one contract transaction and waits for it to be mined.
 *
 * Nonce handling: the NonceManager counts transaction numbers locally. If
 * another process used the same relayer wallet in the meantime (a second
 * server instance, a script), our local count is stale and the node answers
 * "nonce too low". Then we resync from the node and retry ONCE. That is safe:
 * a rejected-for-nonce transaction was never executed. Any other failure also
 * resyncs the counter, but is reported, not retried.
 */
async function sendTx(send: (contract: Contract) => Promise<{ hash: string; wait: (n: number) => Promise<{ blockNumber: number }> }>): Promise<TxResult> {
  const contract = await getWriter();
  for (let attempt = 1; ; attempt++) {
    try {
      const tx = await send(contract);
      const receipt = await tx.wait(1);
      return { txHash: tx.hash, blockNumber: Number(receipt.blockNumber) };
    } catch (err) {
      (contract.runner as NonceManager).reset();
      if (attempt === 1 && isStaleNonce(err)) continue;
      throw translateRevert(err);
    }
  }
}

export function registerOnChain(args: {
  sha256: string;
  pHashBytes32: string;
  signerKeyHash: string;
  storageURI: string;
}): Promise<TxResult> {
  return serialised(() =>
    sendTx((contract) => contract.register(args.sha256, args.pHashBytes32, args.signerKeyHash, args.storageURI)),
  );
}

export function recordEditOnChain(originalHash: string, newHash: string): Promise<TxResult> {
  return serialised(() => sendTx((contract) => contract.recordEdit(originalHash, newHash)));
}

/** Turns the contract's custom errors into readable API errors. */
function translateRevert(err: unknown): unknown {
  const name = (err as { revert?: { name?: string } })?.revert?.name;
  switch (name) {
    case "AlreadyRegistered":
      return new ServiceError(409, "ALREADY_REGISTERED", "This exact image is already registered on-chain");
    case "NotRelayer":
      return new ServiceError(503, "RELAYER_NOT_AUTHORISED", "The relayer wallet is not allow-listed on the contract");
    case "NotRegistered":
      return new ServiceError(404, "PARENT_NOT_REGISTERED", "The parent image is not registered");
    case "EditAlreadyLinked":
    case "EditPredatesOriginal":
    case "SelfEdit":
      return new ServiceError(409, "INVALID_EDIT_LINK", `The contract rejected the edit link (${name})`);
    default:
      return err;
  }
}

/** Link to the transaction on a public block explorer (none for the local chain). */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === 80002) return `https://amoy.polygonscan.com/tx/${txHash}`;
  return null;
}
