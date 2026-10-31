// Local storage adapter: content-addressed layout and path-traversal safety.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage, proofUriFor, storageKeys, type StorageAdapter } from "@/lib/server/storage";

let root: string;
let storage: StorageAdapter; // used through the interface, exactly as the app does
const SHA = "0x" + "ab".repeat(32);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "truthlens-storage-"));
  storage = new LocalStorage(root);
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("storage layout", () => {
  it("names files after the image hash, with the proof next to the image", () => {
    const keys = storageKeys(SHA, "jpg");
    expect(keys.image).toBe(`originals/${"ab".repeat(32)}/image.jpg`);
    expect(keys.proof).toBe(`originals/${"ab".repeat(32)}/proof.json`);
    expect(proofUriFor(`local://${keys.image}`)).toBe(`local://${keys.proof}`);
    expect(proofUriFor(`s3://bucket/${keys.image}`)).toBe(`s3://bucket/${keys.proof}`);
  });
});

describe("LocalStorage", () => {
  it("round-trips bytes through a local:// URI", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const uri = await storage.put(storageKeys(SHA, "png").image, bytes, "image/png");
    expect(uri).toBe(`local://originals/${"ab".repeat(32)}/image.png`);
    expect(await storage.get(uri)).toEqual(bytes);
  });

  it("returns null for a missing file", async () => {
    expect(await storage.get("local://originals/missing/image.jpg")).toBeNull();
  });

  it("refuses keys that try to escape the storage folder", async () => {
    await expect(storage.put("../../evil.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow(/Unsafe/);
    await expect(storage.get("local://../../etc/passwd")).rejects.toThrow(/Unsafe/);
    await expect(storage.put("originals/A B/x", new Uint8Array([1]), "text/plain")).rejects.toThrow(/Unsafe/);
  });
});
