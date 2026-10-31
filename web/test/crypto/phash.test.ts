// Perceptual hash: robust to recompression/resizing, sensitive to content.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import {
  bytes32ToPhash,
  computePHash,
  hammingDistance,
  isPerceptualMatch,
  PHASH_MATCH_THRESHOLD,
  phashToBytes32,
  similarity,
  type RgbaImage,
} from "@/lib/crypto/phash";
import { decodeImage } from "@/lib/image/decode-node";
import { makeScene, makeVariants, type Variant } from "../fixtures/scenes";

const phashOf = async (bytes: Buffer) => computePHash(await decodeImage(bytes));

function solid(width: number, height: number, value: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4).fill(value) };
}

describe("computePHash basics", () => {
  it("returns 64 bits as 0x + 16 hex chars", async () => {
    expect(await phashOf(await makeScene(1))).toMatch(/^0x[0-9a-f]{16}$/);
  });

  it("is deterministic", async () => {
    const scene = await makeScene(1);
    expect(await phashOf(scene)).toBe(await phashOf(scene));
  });

  it("hashes a flat image to zero (no structure, so no bit rises above the median)", () => {
    expect(computePHash(solid(64, 64, 0))).toBe("0x0000000000000000");
    expect(computePHash(solid(64, 64, 200))).toBe("0x0000000000000000");
  });

  it("refuses images smaller than the 32×32 grid", () => {
    expect(() => computePHash(solid(20, 100, 0))).toThrow(/too small/);
  });
});

describe("hamming distance & on-chain encoding", () => {
  it("counts differing bits", () => {
    expect(hammingDistance("0x0000000000000000", "0x0000000000000000")).toBe(0);
    expect(hammingDistance("0x0000000000000000", "0x000000000000000f")).toBe(4);
    expect(hammingDistance("0x0000000000000000", "0xffffffffffffffff")).toBe(64);
    expect(similarity("0x0000000000000000", "0x00000000000000ff")).toBe(87.5);
  });

  it("round-trips through the contract's left-aligned bytes32 format", () => {
    const p = "0x035969259b36a78f";
    const b32 = phashToBytes32(p);
    expect(b32).toBe("0x035969259b36a78f" + "0".repeat(48));
    expect(b32.length).toBe(66);
    expect(bytes32ToPhash(b32)).toBe(p);
    expect(() => phashToBytes32("0x1234")).toThrow();
  });
});

describe("robustness (the reason pHash exists)", () => {
  let original: Buffer;
  let base: string;
  let variants: Variant[];

  beforeAll(async () => {
    original = await makeScene(2);
    base = await phashOf(original);
    variants = await makeVariants(original, await makeScene(3));
  });

  it("SHA-256 changes for every variant, so exact hashing alone cannot find re-shared copies", async () => {
    const originalSha = await sha256Hex(original);
    for (const v of variants) expect(await sha256Hex(v.bytes), v.name).not.toBe(originalSha);
  });

  it("…but every benign variant (recompress, resize, WhatsApp, filters) still matches", async () => {
    for (const v of variants.filter((v) => v.kind === "benign")) {
      const d = hammingDistance(base, await phashOf(v.bytes));
      expect(d, `${v.name}: distance ${d}`).toBeLessThanOrEqual(PHASH_MATCH_THRESHOLD);
    }
  });

  it("recompression and resizing are almost invisible to pHash (≤ 2 bits)", async () => {
    for (const name of ["JPEG quality 30", "Resize to 25%", "WhatsApp-style (fit 1280px, q70)"]) {
      const v = variants.find((v) => v.name === name)!;
      expect(hammingDistance(base, await phashOf(v.bytes)), name).toBeLessThanOrEqual(2);
    }
  });

  it("small local edits stay matched, so the verifier can find the original and show a heatmap", async () => {
    for (const name of ["Edit: object pasted (5% area)", "Edit: caption text added"]) {
      const v = variants.find((v) => v.name === name)!;
      const d = hammingDistance(base, await phashOf(v.bytes));
      expect(d, name).toBeGreaterThan(0); // the edit is visible to the hash…
      expect(isPerceptualMatch(base, await phashOf(v.bytes)), name).toBe(true); // …but still linked
    }
  });

  it("a mirrored image is treated as a different picture", async () => {
    const v = variants.find((v) => v.name === "Edit: mirrored")!;
    expect(hammingDistance(base, await phashOf(v.bytes))).toBeGreaterThan(PHASH_MATCH_THRESHOLD);
  });

  it("honours EXIF orientation: a sideways-stored portrait hashes like the upright image", async () => {
    // Store the pixels rotated 90° anticlockwise and tag them "rotate 90° clockwise
    // to display", as phone cameras do.
    const sideways = await sharp(original).rotate(270).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
    expect(hammingDistance(base, await phashOf(sideways))).toBeLessThanOrEqual(2);
  });
});

describe("discrimination", () => {
  it("unrelated images are far apart, well above the threshold", async () => {
    const hashes = await Promise.all([10, 11, 12, 13, 14, 15].map(async (s) => phashOf(await makeScene(s))));
    for (let a = 0; a < hashes.length; a++) {
      for (let b = a + 1; b < hashes.length; b++) {
        expect(hammingDistance(hashes[a], hashes[b]), `scene ${a} vs ${b}`).toBeGreaterThan(PHASH_MATCH_THRESHOLD);
      }
    }
  });
});
