// Live verify: the frame-window decision, the alignment grid, and the fast
// Hamming distance the matcher relies on.
import { describe, expect, it } from "vitest";
import { hammingDistance, phashWords, wordDistance } from "@/lib/crypto/phash";
import {
  boxThumb,
  cropRect,
  decide,
  LIVE_MATCH,
  NEED_HITS,
  pushFrame,
  SEARCH_GRID,
  WINDOW,
  type FrameResult,
} from "@/lib/live-match";
import { ImageIndex } from "@/lib/server/image-index";

const A = "0xaaaa";
const B = "0xbbbb";
const frames = (...rs: FrameResult[]) => rs.reduce<FrameResult[]>((h, r) => pushFrame(h, r), []);

describe("decide (sliding window of frames)", () => {
  it("waits for enough frames before saying anything", () => {
    expect(decide(frames({ sha256: A, distance: 2 }))).toEqual({ kind: "warming" });
  });

  it("locks once the same photo wins NEED_HITS frames, using the median distance", () => {
    const state = decide(frames({ sha256: A, distance: 9 }, null, { sha256: A, distance: 3 }, { sha256: A, distance: 5 }));
    expect(state).toMatchObject({ kind: "match", sha256: A, distance: 5, hits: NEED_HITS, close: true });
  });

  it("does not lock on photos that only flicker in", () => {
    const state = decide(frames({ sha256: A, distance: 4 }, { sha256: B, distance: 4 }, null, { sha256: A, distance: 4 }));
    expect(state.kind).toBe("searching");
  });

  it("reports 'none' after a full window with no candidate in range", () => {
    expect(decide(frames(...Array<FrameResult>(WINDOW).fill(null))).kind).toBe("none");
    expect(decide(frames(...Array<FrameResult>(WINDOW).fill({ sha256: A, distance: LIVE_MATCH + 1 }))).kind).toBe("none");
  });

  it("keeps only the newest WINDOW frames", () => {
    const h = frames(...Array<FrameResult>(WINDOW + 4).fill({ sha256: A, distance: 1 }));
    expect(h).toHaveLength(WINDOW);
  });
});

describe("alignment grid", () => {
  it("has 135 crops, all inside the frame", () => {
    expect(SEARCH_GRID).toHaveLength(135);
    for (const c of SEARCH_GRID) {
      const r = cropRect(c, 320, 240);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(320 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(240 + 1e-9);
    }
  });

  it("box-averages a crop into a thumbnail with a 64-px long side", () => {
    const src = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(200) };
    const t = boxThumb(src, { x: 0, y: 0, w: 4, h: 3 });
    expect([t.width, t.height]).toEqual([64, 48]);
    expect(t.data[0]).toBe(200);
  });
});

describe("fast Hamming distance", () => {
  it("agrees with a bit-by-bit count", () => {
    const slow = (a: string, b: string) => [...(BigInt(a) ^ BigInt(b)).toString(2)].filter((c) => c === "1").length;
    const samples = ["0x0000000000000000", "0xffffffffffffffff", "0x8000000000000001", "0x0123456789abcdef", "0xfedcba9876543210"];
    for (const a of samples) for (const b of samples) expect(hammingDistance(a, b)).toBe(slow(a, b));
    expect(wordDistance(phashWords("0xff"), phashWords("0x0f"))).toBe(4);
  });
});

describe("ImageIndex.bestOf (live matching)", () => {
  const record = (sha256: string, pHash: string, index: number) => ({
    sha256, pHash, signerKeyHash: "0x" + "1".repeat(64), storageURI: "local://x", registrar: "0x0",
    timestamp: 1, blockNumber: index + 1, index, parentHash: null, txHash: null,
  });

  it("returns the record closest to ANY of the frame's hashes, and sees new writes", () => {
    const idx = new ImageIndex(":memory:");
    idx.upsert(record("0x" + "a".repeat(64), "0x00000000000000ff", 0));
    idx.upsert(record("0x" + "b".repeat(64), "0xffffffff00000000", 1));
    expect(idx.bestOf(["0x0000000000000000", "0xffffffff00000001"])).toEqual({ sha256: "0x" + "b".repeat(64), distance: 1 });

    // The in-memory pHash cache must be cleared by writes.
    idx.upsert(record("0x" + "c".repeat(64), "0x0000000000000000", 2));
    expect(idx.bestOf(["0x0000000000000000"])).toEqual({ sha256: "0x" + "c".repeat(64), distance: 0 });
  });
});
