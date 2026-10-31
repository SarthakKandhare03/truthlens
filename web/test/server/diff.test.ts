// Tamper heatmap: benign copies show no change, edits light up WHERE they happened.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { compareImages, fitToneMapping, GRID_SIZE, NOT_A_DERIVATIVE_PERCENT } from "@/lib/image/diff";
import { makeScene, makeVariants, SCENE_HEIGHT, SCENE_WIDTH, type Variant } from "../fixtures/scenes";

let original: Buffer;
let variants: Variant[];
const variant = (name: string) => variants.find((v) => v.name === name)!.bytes;

beforeAll(async () => {
  original = await makeScene(21);
  variants = await makeVariants(original, await makeScene(22));
});

describe("compareImages on benign copies", () => {
  it("reports an identical image as 0% changed with exact alignment", async () => {
    const d = await compareImages(original, original);
    expect(d.changedPercent).toBe(0);
    expect(d.alignment).toBe("exact");
    expect(d.grid).toHaveLength(GRID_SIZE * GRID_SIZE);
  });

  it("ignores recompression and resizing (< 1% changed)", async () => {
    for (const name of ["JPEG quality 30", "Resize to 25%", "WhatsApp-style (fit 1280px, q70)", "Double recompress (q85 → q60)"]) {
      const d = await compareImages(original, variant(name));
      expect(d.changedPercent, name).toBeLessThan(1);
    }
    expect((await compareImages(original, variant("Resize to 50%"))).alignment).toBe("resized");
  });

  it("reports a brightness filter once as a global adjustment, not as 100% tampering", async () => {
    const d = await compareImages(original, variant("Brightness +15%"));
    expect(d.globalAdjustment).toBe(true);
    expect(d.changedPercent).toBeLessThan(1);
  });
});

describe("compareImages on edits", () => {
  it("measures a clearly visible edit at roughly its true size (12% of the area)", async () => {
    // Re-tone a rectangle covering 12% of the image: brighten it by 100 levels if
    // it is dark, darken it if it is bright, so every pixel visibly changes.
    // (A pasted object whose brightness happens to match the background is
    // under-reported. That is the documented grayscale limitation.)
    const rect = { left: 300, top: 250, width: Math.round(SCENE_WIDTH * 0.3464), height: Math.round(SCENE_HEIGHT * 0.3464) };
    const region = sharp(original).extract(rect);
    const { channels } = await region.clone().stats();
    const meanLuma = 0.299 * channels[0].mean + 0.587 * channels[1].mean + 0.114 * channels[2].mean;
    const patch = await region.linear(1, meanLuma < 128 ? 100 : -100).png().toBuffer();
    const edited = await sharp(original).composite([{ input: patch, left: rect.left, top: rect.top }]).jpeg({ quality: 90 }).toBuffer();

    const d = await compareImages(original, edited);
    expect(d.changedPercent).toBeGreaterThan(9);
    expect(d.changedPercent).toBeLessThan(15);
    expect(d.globalAdjustment).toBe(false); // a local edit is not mistaken for a filter
  });

  it("still catches the fixture's pasted objects (some change reported)", async () => {
    for (const name of ["Edit: object pasted (5% area)", "Edit: object pasted (12% area)", "Edit: caption text added"]) {
      expect((await compareImages(original, variant(name))).changedPercent, name).toBeGreaterThan(1);
    }
  });

  it("puts the heat exactly where the edit is", async () => {
    // Paste a white square into the top-left grid cells only.
    const cell = SCENE_WIDTH / GRID_SIZE;
    const square = await sharp({
      create: { width: Math.round(cell * 3), height: Math.round((SCENE_HEIGHT / GRID_SIZE) * 3), channels: 3, background: "#ffffff" },
    }).png().toBuffer();
    const edited = await sharp(original).composite([{ input: square, left: 0, top: 0 }]).jpeg({ quality: 90 }).toBuffer();

    const d = await compareImages(original, edited);
    const at = (row: number, col: number) => d.grid[row * GRID_SIZE + col];
    expect(at(1, 1)).toBeGreaterThan(0.5); // inside the pasted square
    expect(at(10, 10)).toBe(0); // far away: untouched
    expect(at(15, 15)).toBe(0);
  });

  it("an unrelated image is far beyond the 'not a derivative' limit", async () => {
    const d = await compareImages(original, await makeScene(999));
    expect(d.changedPercent).toBeGreaterThan(NOT_A_DERIVATIVE_PERCENT);
  });

  it("flags a crop that changes the aspect ratio as approximate alignment", async () => {
    const cropped = await sharp(original).extract({ left: 0, top: 0, width: 1200, height: 1200 }).jpeg().toBuffer();
    expect((await compareImages(original, cropped)).alignment).toBe("approximate");
  });
});

describe("fitToneMapping (robust brightness/contrast fit)", () => {
  it("recovers a global filter even when 20% of the pixels were edited", () => {
    const n = 10_000;
    const orig = new Uint8Array(n);
    const suspect = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      orig[i] = 40 + ((i * 7) % 160);
      // Suspect = original darkened by the filter orig = 1.2·suspect + 10 ...
      suspect[i] = Math.round((orig[i] - 10) / 1.2);
    }
    // ...plus a local edit: 20% of pixels painted black.
    for (let i = 0; i < n * 0.2; i++) suspect[i] = 0;

    const { gain, offset } = fitToneMapping(orig, suspect);
    expect(gain).toBeCloseTo(1.2, 1);
    expect(offset).toBeCloseTo(10, 0);
  });
});
