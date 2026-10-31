// Device identity persisted in IndexedDB (simulated in Node by fake-indexeddb).
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { utf8, hexToBytes } from "@/lib/crypto/encoding";
import { signImageHash, verifyImageSignature } from "@/lib/crypto/signing";

type Store = typeof import("@/lib/crypto/device-key-store");

/**
 * Loads a FRESH copy of the module, like a page reload or a second browser tab:
 * the in-memory cache is gone, but IndexedDB (globalThis.indexedDB) persists.
 */
async function freshPage(): Promise<Store> {
  vi.resetModules();
  return import("@/lib/crypto/device-key-store");
}

beforeEach(() => {
  // A brand-new, empty "browser profile" for every test.
  globalThis.indexedDB = new IDBFactory();
});

describe("getDeviceIdentity", () => {
  it("creates a non-extractable signing key on first use", async () => {
    const { getDeviceIdentity } = await freshPage();
    const id = await getDeviceIdentity();

    expect(id.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", id.privateKey)).rejects.toThrow();
    expect(id.keyFingerprint).toBe(await sha256Hex(hexToBytes(id.publicKeyHex)));
    expect(Date.parse(id.createdAt)).not.toBeNaN();
  });

  it("returns the same identity on repeated and concurrent calls", async () => {
    const { getDeviceIdentity } = await freshPage();
    const all = await Promise.all(Array.from({ length: 5 }, () => getDeviceIdentity()));
    expect(new Set(all.map((i) => i.keyFingerprint)).size).toBe(1);
  });

  it("survives a page reload, and the restored key can still sign", async () => {
    const first = await (await freshPage()).getDeviceIdentity();
    const afterReload = await (await freshPage()).getDeviceIdentity();

    expect(afterReload.keyFingerprint).toBe(first.keyFingerprint);
    expect(afterReload.privateKey.extractable).toBe(false); // still locked after storage

    const hash = await sha256Hex(utf8("photo"));
    const sig = await signImageHash(afterReload.privateKey, hash);
    expect(await verifyImageSignature(first.publicKeyHex, hash, sig)).toBe(true);
  });

  it("two tabs racing on first use end up with ONE shared identity", async () => {
    const tabA = await freshPage();
    const tabB = await freshPage(); // separate module instance = separate in-memory cache
    const [a, b] = await Promise.all([tabA.getDeviceIdentity(), tabB.getDeviceIdentity()]);
    expect(a.keyFingerprint).toBe(b.keyFingerprint);
  });

  it("resetDeviceIdentity creates a new key next time", async () => {
    const store = await freshPage();
    const before = await store.getDeviceIdentity();
    await store.resetDeviceIdentity();
    const after = await store.getDeviceIdentity();
    expect(after.keyFingerprint).not.toBe(before.keyFingerprint);
  });
});
