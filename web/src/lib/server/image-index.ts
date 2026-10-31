// SQLite search index of registered images: a CACHE of the blockchain.
//
// Why have one at all? The contract can look up an EXACT SHA-256 instantly,
// but it cannot answer "which registered pHash is closest to this one?". That
// needs a scan over every pHash, which is fine in a local database but slow
// and costly as thousands of contract calls. The index also powers the Chain
// Explorer feed and search.
//
// The blockchain stays the source of truth:
//   - syncIndex() rebuilds the index from contract state (getHashes + getRecord),
//     so deleting the database file loses nothing;
//   - if the chain was reset (e.g. the local Hardhat node restarted), sync
//     notices that the chain no longer matches and rebuilds from scratch;
//   - the verifier re-reads any candidate from the chain before trusting it.
//
// Uses Node's built-in SQLite module (node:sqlite, Node 22.5+). There is no
// ORM or native add-on to install, and the whole schema is the CREATE TABLE
// below. Prisma would add a schema file, code generation and a native driver
// for a single table, so it was left out on purpose.
//
// Nearest-neighbour search is a linear scan with Hamming distance, which is
// instant for thousands of images. At millions you would use a BK-tree or
// multi-index hashing.
import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChainRecord } from "../api-types";
import { phashWords, wordDistance } from "../crypto/phash";
import { readHashAt, readHashPage, readRecord, readTotalRecords } from "./chain";
import { config } from "./config";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS images (
    sha256          TEXT PRIMARY KEY,
    phash           TEXT NOT NULL,
    signer_key_hash TEXT NOT NULL,
    storage_uri     TEXT NOT NULL,
    registrar       TEXT NOT NULL,
    timestamp       INTEGER NOT NULL,
    block_number    INTEGER NOT NULL,
    chain_index     INTEGER NOT NULL UNIQUE,
    parent_hash     TEXT,
    tx_hash         TEXT
  );
  CREATE INDEX IF NOT EXISTS images_by_tx ON images(tx_hash);
`;

type Row = {
  sha256: string;
  phash: string;
  signer_key_hash: string;
  storage_uri: string;
  registrar: string;
  timestamp: number;
  block_number: number;
  chain_index: number;
  parent_hash: string | null;
  tx_hash: string | null;
};

const toRecord = (r: Row): ChainRecord => ({
  sha256: r.sha256,
  pHash: r.phash,
  signerKeyHash: r.signer_key_hash,
  storageURI: r.storage_uri,
  registrar: r.registrar,
  timestamp: r.timestamp,
  blockNumber: r.block_number,
  index: r.chain_index,
  parentHash: r.parent_hash,
  txHash: r.tx_hash,
});

export class ImageIndex {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  /** Insert or refresh a record. A known tx hash is never overwritten with null. */
  upsert(rec: ChainRecord): void {
    this.phashCache = null;
    // Self-healing: each chain_index belongs to exactly one image on the CURRENT
    // chain. A different image in that slot is left over from a chain that was
    // reset (e.g. the local Hardhat node restarted), so the chain wins.
    this.db.prepare("DELETE FROM images WHERE chain_index = ? AND sha256 <> ?").run(rec.index, rec.sha256);
    this.db
      .prepare(
        `INSERT INTO images (sha256, phash, signer_key_hash, storage_uri, registrar, timestamp,
                             block_number, chain_index, parent_hash, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha256) DO UPDATE SET
           phash = excluded.phash, signer_key_hash = excluded.signer_key_hash,
           storage_uri = excluded.storage_uri, registrar = excluded.registrar,
           timestamp = excluded.timestamp, block_number = excluded.block_number,
           chain_index = excluded.chain_index, parent_hash = excluded.parent_hash,
           tx_hash = COALESCE(excluded.tx_hash, images.tx_hash)`,
      )
      .run(
        rec.sha256, rec.pHash, rec.signerKeyHash, rec.storageURI, rec.registrar, rec.timestamp,
        rec.blockNumber, rec.index, rec.parentHash, rec.txHash,
      );
  }

  setParent(sha256: string, parentHash: string): void {
    this.phashCache = null;
    this.db.prepare("UPDATE images SET parent_hash = ? WHERE sha256 = ?").run(parentHash, sha256);
  }

  get(sha256: string): ChainRecord | null {
    const row = this.db.prepare("SELECT * FROM images WHERE sha256 = ?").get(sha256) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number }).n;
  }

  /** Registered images that are linked as an edit of another image. */
  countEdits(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM images WHERE parent_hash IS NOT NULL").get() as { n: number }).n;
  }

  hashAtIndex(index: number): string | null {
    const row = this.db.prepare("SELECT sha256 FROM images WHERE chain_index = ?").get(index) as
      | { sha256: string }
      | undefined;
    return row?.sha256 ?? null;
  }

  clear(): void {
    this.phashCache = null;
    this.db.exec("DELETE FROM images");
  }

  // Every registered pHash, pre-split into 32-bit words, kept in memory: live
  // verify compares ~135 hashes per camera frame several times a second, so
  // re-reading the table each time would dominate. Any write clears it.
  private phashCache: { sha256: string; words: [number, number] }[] | null = null;

  private phashes() {
    this.phashCache ??= (this.db.prepare("SELECT sha256, phash FROM images").all() as { sha256: string; phash: string }[]).map(
      (r) => ({ sha256: r.sha256, words: phashWords(r.phash) }),
    );
    return this.phashCache;
  }

  /** Registered images whose pHash is within `maxDistance` bits, closest first. */
  nearest(pHash: string, maxDistance: number, limit = 5): { sha256: string; distance: number }[] {
    const target = phashWords(pHash);
    return this.phashes()
      .map((r) => ({ sha256: r.sha256, distance: wordDistance(target, r.words) }))
      .filter((r) => r.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  /**
   * Live verify: the registered image closest to ANY of `hashes` (one camera
   * frame hashed at many crops), and the distance of the best crop.
   */
  bestOf(hashes: string[]): { sha256: string; distance: number } | null {
    const targets = hashes.map(phashWords);
    let best: { sha256: string; distance: number } | null = null;
    for (const r of this.phashes()) {
      for (const t of targets) {
        const d = wordDistance(t, r.words);
        if (!best || d < best.distance) best = { sha256: r.sha256, distance: d };
      }
    }
    return best;
  }

  /** Distance to the single closest registered pHash (for transparency in the UI). */
  nearestDistance(pHash: string): number | null {
    const [best] = this.nearest(pHash, 64, 1);
    return best?.distance ?? null;
  }

  /** Newest registrations first; `beforeIndex` pages backwards. */
  recent(limit: number, beforeIndex?: number): ChainRecord[] {
    const rows = (
      beforeIndex === undefined
        ? this.db.prepare("SELECT * FROM images ORDER BY chain_index DESC LIMIT ?").all(limit)
        : this.db.prepare("SELECT * FROM images WHERE chain_index < ? ORDER BY chain_index DESC LIMIT ?").all(beforeIndex, limit)
    ) as Row[];
    return rows.map(toRecord);
  }

  /** Explorer search: full or partial SHA-256 / tx hash, or a block number. */
  search(query: string, limit = 20): ChainRecord[] {
    const q = query.trim().toLowerCase();
    if (/^#?\d+$/.test(q)) {
      const block = Number(q.replace("#", ""));
      return (this.db.prepare("SELECT * FROM images WHERE block_number = ? LIMIT ?").all(block, limit) as Row[]).map(toRecord);
    }
    if (!/^(0x)?[0-9a-f]{4,64}$/.test(q)) return [];
    const prefix = (q.startsWith("0x") ? q : "0x" + q) + "%";
    return (
      this.db
        .prepare("SELECT * FROM images WHERE sha256 LIKE ? OR tx_hash LIKE ? ORDER BY chain_index DESC LIMIT ?")
        .all(prefix, prefix, limit) as Row[]
    ).map(toRecord);
  }
}

// One shared instance per server process, parked on globalThis so Next.js
// hot-reloading in development does not open a new database on every edit.
//
// Bump INDEX_API_VERSION whenever ImageIndex gains or changes a method: a
// parked instance from before a hot reload would otherwise keep the OLD
// methods ("countEdits is not a function"). A version number is used instead
// of `instanceof` on purpose: Next.js bundles API routes and pages separately,
// so each bundle has its OWN copy of the ImageIndex class, and `instanceof`
// would make them replace each other's instance on every request.
const INDEX_API_VERSION = 3;
const globalForIndex = globalThis as unknown as {
  __truthlensIndex?: { file: string; version: number; index: ImageIndex };
};

export function getIndex(): ImageIndex {
  const file = config.databasePath;
  const cached = globalForIndex.__truthlensIndex;
  if (cached?.file !== file || cached.version !== INDEX_API_VERSION) {
    // The old handle is NOT closed: another bundle may still be mid-query on it.
    // (Development only; it is garbage-collected once unreferenced.)
    globalForIndex.__truthlensIndex = { file, version: INDEX_API_VERSION, index: new ImageIndex(file) };
  }
  return globalForIndex.__truthlensIndex!.index;
}

// ---------------------------------------------------------------------------
// Sync from the chain
// ---------------------------------------------------------------------------

let syncing: Promise<void> | null = null;

/**
 * Brings the index up to date with the contract. Cheap when nothing changed
 * (one totalRecords() call), so it runs before every verification and feed.
 */
export function syncIndex(): Promise<void> {
  syncing ??= doSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function doSync(): Promise<void> {
  const index = getIndex();
  const total = await readTotalRecords();
  let have = index.count();

  // Has the chain been reset or replaced? Then the cache describes a chain
  // that no longer exists: start over.
  if (have > total || (have > 0 && (await readHashAt(have - 1)) !== index.hashAtIndex(have - 1))) {
    index.clear();
    have = 0;
  }

  const PAGE = 100;
  for (let start = have; start < total; start += PAGE) {
    for (const sha of await readHashPage(start, PAGE)) {
      const rec = await readRecord(sha);
      if (rec) index.upsert(rec);
    }
  }
}
