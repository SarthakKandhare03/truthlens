// SQLite index: nearest perceptual-hash search, feed paging and explorer search.
import { beforeEach, describe, expect, it } from "vitest";
import type { ChainRecord } from "@/lib/api-types";
import { ImageIndex } from "@/lib/server/image-index";

const hex32 = (n: number) => "0x" + n.toString(16).padStart(64, "0");

function record(i: number, pHash: string, extra: Partial<ChainRecord> = {}): ChainRecord {
  return {
    sha256: hex32(1000 + i),
    pHash,
    signerKeyHash: hex32(7),
    storageURI: `local://originals/${i}/image.jpg`,
    registrar: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    timestamp: 1_700_000_000 + i,
    blockNumber: 10 + i,
    index: i,
    parentHash: null,
    txHash: hex32(5000 + i),
    ...extra,
  };
}

let index: ImageIndex;
beforeEach(() => {
  index = new ImageIndex(":memory:");
  index.upsert(record(0, "0x0000000000000000"));
  index.upsert(record(1, "0x00000000000000ff")); // 8 bits from #0
  index.upsert(record(2, "0xffffffffffffffff")); // 64 bits from #0
});

describe("ImageIndex", () => {
  it("finds the nearest pHashes within a threshold, closest first", () => {
    const hits = index.nearest("0x0000000000000001", 16);
    expect(hits.map((h) => h.distance)).toEqual([1, 7]);
    expect(hits[0].sha256).toBe(hex32(1000));
    expect(index.nearestDistance("0xfffffffffffffff0")).toBe(4);
  });

  it("returns nothing when no pHash is within the threshold", () => {
    expect(index.nearest("0x0f0f0f0f0f0f0f0f", 16)).toEqual([]);
  });

  it("keeps a known tx hash when the same record is re-synced from the chain without one", () => {
    index.upsert(record(0, "0x0000000000000000", { txHash: null }));
    expect(index.get(hex32(1000))?.txHash).toBe(hex32(5000));
  });

  it("pages the feed newest-first", () => {
    expect(index.recent(2).map((r) => r.index)).toEqual([2, 1]);
    expect(index.recent(2, 1).map((r) => r.index)).toEqual([0]);
  });

  it("searches by hash prefix (with or without 0x), tx hash, or block number", () => {
    const shaPrefix = hex32(1001).slice(0, 62);
    expect(index.search(shaPrefix).map((r) => r.index)).toContain(1);
    expect(index.search(hex32(5002)).map((r) => r.index)).toEqual([2]);
    expect(index.search("#12").map((r) => r.index)).toEqual([2]);
    expect(index.search("not a hash")).toEqual([]);
  });

  it("can be cleared and rebuilt (it is only a cache of the chain)", () => {
    index.clear();
    expect(index.count()).toBe(0);
  });
});
