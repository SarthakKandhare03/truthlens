// Cropped / mirrored / rotated copies: variant fingerprints, alignment, and
// the rule that a wrong photo is never accepted as the original.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { computePHash, hammingDistance, PHASH_MATCH_THRESHOLD } from "@/lib/crypto/phash";
import { decodeImage } from "@/lib/image/decode-node";
import { compareDerivative, computeVariants, MIN_KEPT, UPRIGHT, variantPlan, VARIANT_SHORTLIST } from "@/lib/image/derivative";
import { ImageIndex } from "@/lib/server/image-index";
import { makeScene } from "../fixtures/scenes";

let original: Buffer;
let other: Buffer;
beforeAll(async () => {
  original = await sharp(await makeScene(31)).jpeg({ quality: 92 }).toBuffer();
  other = await sharp(await makeScene(32)).jpeg({ quality: 92 }).toBuffer();
});

const cropOf = async (img: Buffer, l: number, t: number, r: number, b: number) => {
  const m = await sharp(img).metadata();
  return sharp(img)
    .extract({ left: Math.round(m.width! * l), top: Math.round(m.height! * t), width: Math.round(m.width! * (1 - l - r)), height: Math.round(m.height! * (1 - t - b)) })
    .jpeg({ quality: 88 })
    .toBuffer();
};

describe("variant plan", () => {
  it("covers 7 turned/mirrored versions and 400 crops", () => {
    const plan = variantPlan(4 / 3);
    expect(plan.filter((v) => v.rect.w === 1 && v.rect.h === 1)).toHaveLength(7);
    expect(plan).toHaveLength(7 + 2 * 4 * 25 * 2);
    for (const v of plan) {
      expect(v.rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(v.rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(v.rect.x + v.rect.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(v.rect.y + v.rect.h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("a mirrored copy hashes like the original's mirror variant", async () => {
    const variants = await computeVariants(original);
    const mirror = variants.find((v) => v.orient.mirror && v.orient.rot === 0 && v.rect.w === 1)!;
    const copy = computePHash(await decodeImage(await sharp(original).flop().jpeg().toBuffer()));
    expect(hammingDistance(copy, mirror.pHash)).toBeLessThanOrEqual(4);
  }, 30_000);
});

describe("compareDerivative", () => {
  it("finds where a crop came from and sees no change", async () => {
    const copy = await cropOf(original, 0.2, 0.1, 0.05, 0.2); // keeps 75% × 70%
    const diff = await compareDerivative(original, copy, UPRIGHT, false);
    expect(diff).not.toBeNull();
    expect(diff!.changedPercent).toBeLessThan(2);
    expect(diff!.geometry.cropped).toBe(true);
    expect(diff!.geometry.rect.x).toBeCloseTo(0.2, 1);
    expect(diff!.geometry.rect.y).toBeCloseTo(0.1, 1);
    expect(diff!.geometry.keptPercent).toBeGreaterThan(45);
  }, 30_000);

  it("undoes a mirror + rotation", async () => {
    const copy = await sharp(original).rotate(90).flop().jpeg({ quality: 88 }).toBuffer();
    const diff = await compareDerivative(original, copy, { rot: 90, mirror: true }, false);
    expect(diff?.changedPercent).toBeLessThan(2);
    expect(diff?.geometry).toMatchObject({ rotation: 90, mirrored: true });
  }, 30_000);

  it("refuses an unrelated photo when only a variant matched (plain diff not allowed)", async () => {
    const stranger = await cropOf(other, 0.1, 0.1, 0.1, 0.1);
    expect(await compareDerivative(original, stranger, UPRIGHT, false)).toBeNull();
  }, 30_000);

  it("never links a fragment smaller than MIN_KEPT of the original", async () => {
    const tiny = await cropOf(original, 0.35, 0.35, 0.35, 0.35); // 30% × 30% = 9%
    const diff = await compareDerivative(original, tiny, UPRIGHT, false);
    expect(diff === null || diff.geometry.rect.w * diff.geometry.rect.h >= MIN_KEPT).toBe(true);
  }, 30_000);
});

describe("ImageIndex variants", () => {
  it("shortlists a cropped copy through its variant, and clears with the index", async () => {
    const idx = new ImageIndex(":memory:");
    const sha256 = "0x" + "d".repeat(64);
    const pHash = computePHash(await decodeImage(original));
    idx.upsert({ sha256, pHash, signerKeyHash: "0x" + "1".repeat(64), storageURI: "local://x", registrar: "0x0", timestamp: 1, blockNumber: 1, index: 0, parentHash: null, txHash: null });
    expect(idx.missingVariants()).toHaveLength(1);
    idx.setVariants(sha256, await computeVariants(original));
    expect(idx.missingVariants()).toHaveLength(0);

    const copy = computePHash(await decodeImage(await cropOf(original, 0.12, 0.12, 0.12, 0.12)));
    expect(hammingDistance(copy, pHash)).toBeGreaterThan(PHASH_MATCH_THRESHOLD - 4); // the plain hash alone struggles…
    const [hit] = idx.shortlistVariants(copy, VARIANT_SHORTLIST, 4);
    expect(hit?.sha256).toBe(sha256); // …the variants find it
    expect(hit.variant.rect.w).toBeLessThan(1);

    idx.clear();
    expect(idx.shortlistVariants(copy, VARIANT_SHORTLIST, 4)).toHaveLength(0);
  }, 30_000);
});
