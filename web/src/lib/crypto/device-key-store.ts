// Browser-side storage for this device's signing key, kept in IndexedDB.
//
// Why IndexedDB? A CryptoKey object can be saved there AS IS (the browser
// structured-clones it), and it stays non-extractable: the page can keep using
// the private key to sign after a reload, but no script can ever read the raw
// key bytes. localStorage could only hold strings, which would mean exporting
// the private key, which is exactly what we want to make impossible.
//
// Limits to be honest about (worth mentioning in the viva):
//   - Clearing site data deletes the key. The device then gets a new identity,
//     and old photos still verify, because their public key is stored with them.
//   - This proves "signed by the same browser profile", not "signed by a
//     hardware secure enclave". A native app could use the phone's secure
//     element (Android StrongBox / iOS Secure Enclave) for stronger guarantees.
import { exportPublicKey, generateDeviceKeyPair, publicKeyFingerprint } from "./signing";

const DB_NAME = "truthlens";
const DB_VERSION = 1;
const STORE = "keys";
const RECORD_ID = "device";

export type DeviceIdentity = {
  privateKey: CryptoKey; // non-extractable, sign-only
  publicKey: CryptoKey;
  publicKeyHex: string; // 65-byte uncompressed P-256 point
  keyFingerprint: string; // sha256(publicKey), what goes on-chain as signerKeyHash
  createdAt: string; // ISO timestamp
};

type StoredRecord = DeviceIdentity & { id: typeof RECORD_ID };

// ---------------------------------------------------------------------------
// Minimal promise wrapper around the callback-based IndexedDB API
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs one request in its own transaction; resolves once the transaction commits. */
async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Shared in-flight promise: React (in dev) runs effects twice, and two
// components may ask at once. Without this they could each create a key.
let pending: Promise<DeviceIdentity> | null = null;

/** This device's identity, creating and persisting a key pair on first use. */
export function getDeviceIdentity(): Promise<DeviceIdentity> {
  pending ??= loadOrCreate().catch((err) => {
    pending = null; // let the next call retry instead of caching the failure
    throw err;
  });
  return pending;
}

/** Forget the device key (e.g. a "reset device identity" button). */
export async function resetDeviceIdentity(): Promise<void> {
  pending = null;
  await run("readwrite", (s) => s.delete(RECORD_ID));
}

async function loadOrCreate(): Promise<DeviceIdentity> {
  const existing = await run<StoredRecord | undefined>("readonly", (s) => s.get(RECORD_ID));
  if (existing) return strip(existing);

  const pair = await generateDeviceKeyPair();
  const publicKeyHex = await exportPublicKey(pair.publicKey);
  const record: StoredRecord = {
    id: RECORD_ID,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyHex,
    keyFingerprint: await publicKeyFingerprint(publicKeyHex),
    createdAt: new Date().toISOString(),
  };

  try {
    // `add` (not `put`) fails if a record already exists. If another tab
    // created a key a moment ago, we keep theirs instead of overwriting it.
    await run("readwrite", (s) => s.add(record));
  } catch (err) {
    if ((err as DOMException | null)?.name !== "ConstraintError") throw err;
    const winner = await run<StoredRecord | undefined>("readonly", (s) => s.get(RECORD_ID));
    if (!winner) throw err;
    return strip(winner);
  }

  // Ask the browser not to evict our storage under disk pressure (best effort).
  await globalThis.navigator?.storage?.persist?.().catch(() => false);
  return strip(record);
}

function strip(record: StoredRecord): DeviceIdentity {
  const { privateKey, publicKey, publicKeyHex, keyFingerprint, createdAt } = record;
  return { privateKey, publicKey, publicKeyHex, keyFingerprint, createdAt };
}
