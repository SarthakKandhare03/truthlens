// ECDSA P-256 device signatures.
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { bytesToHex, hexToBytes, utf8 } from "@/lib/crypto/encoding";
import {
  captureMessage,
  exportPublicKey,
  generateDeviceKeyPair,
  publicKeyFingerprint,
  signImageHash,
  SIGNATURE_DOMAIN,
  verifyImageSignature,
} from "@/lib/crypto/signing";

let device: CryptoKeyPair;
let publicKeyHex: string;
let imageHash: string;

beforeAll(async () => {
  device = await generateDeviceKeyPair();
  publicKeyHex = await exportPublicKey(device.publicKey);
  imageHash = await sha256Hex(utf8("pretend these are JPEG bytes"));
});

describe("device key pair", () => {
  it("creates a NON-extractable private key: it can sign, but its bytes can never be read", async () => {
    expect(device.privateKey.extractable).toBe(false);
    expect(device.privateKey.usages).toEqual(["sign"]);
    await expect(crypto.subtle.exportKey("pkcs8", device.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", device.privateKey)).rejects.toThrow();
  });

  it("exports the public key as a 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y)", () => {
    const bytes = hexToBytes(publicKeyHex);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("fingerprints the public key with SHA-256 (the on-chain signerKeyHash)", async () => {
    expect(await publicKeyFingerprint(publicKeyHex)).toBe(await sha256Hex(hexToBytes(publicKeyHex)));
  });
});

describe("signing and verification", () => {
  it("produces a 64-byte signature that verifies", async () => {
    const sig = await signImageHash(device.privateKey, imageHash);
    expect(hexToBytes(sig).length).toBe(64);
    expect(await verifyImageSignature(publicKeyHex, imageHash, sig)).toBe(true);
  });

  it("uses a fresh random nonce each time: two signatures differ, both are valid", async () => {
    const s1 = await signImageHash(device.privateKey, imageHash);
    const s2 = await signImageHash(device.privateKey, imageHash);
    expect(s1).not.toBe(s2);
    expect(await verifyImageSignature(publicKeyHex, imageHash, s1)).toBe(true);
    expect(await verifyImageSignature(publicKeyHex, imageHash, s2)).toBe(true);
  });

  it("rejects the signature for a different image hash", async () => {
    const sig = await signImageHash(device.privateKey, imageHash);
    const otherHash = await sha256Hex(utf8("a different photo"));
    expect(await verifyImageSignature(publicKeyHex, otherHash, sig)).toBe(false);
  });

  it("rejects a signature made by a different device", async () => {
    const other = await generateDeviceKeyPair();
    const sig = await signImageHash(other.privateKey, imageHash);
    expect(await verifyImageSignature(publicKeyHex, imageHash, sig)).toBe(false);
  });

  it("rejects a signature with a single flipped bit", async () => {
    const sig = hexToBytes(await signImageHash(device.privateKey, imageHash));
    sig[10] ^= 0x01;
    expect(await verifyImageSignature(publicKeyHex, imageHash, bytesToHex(sig))).toBe(false);
  });

  it("returns false (never throws) for malformed input from untrusted callers", async () => {
    const sig = await signImageHash(device.privateKey, imageHash);
    expect(await verifyImageSignature(publicKeyHex, imageHash, "0x1234")).toBe(false);
    expect(await verifyImageSignature("0x04" + "00".repeat(64), imageHash, sig)).toBe(false); // not on the curve
    expect(await verifyImageSignature("not hex", imageHash, sig)).toBe(false);
    expect(await verifyImageSignature(publicKeyHex, "0xdeadbeef", sig)).toBe(false);
  });
});

describe("domain separation", () => {
  it("signs 'TruthLens/capture/v1' ‖ 0x00 ‖ sha256, not the bare hash", () => {
    const msg = captureMessage(imageHash);
    const prefix = utf8(SIGNATURE_DOMAIN);
    expect(msg.length).toBe(prefix.length + 1 + 32);
    expect(msg.subarray(0, prefix.length)).toEqual(prefix);
    expect(msg[prefix.length]).toBe(0);
    expect(bytesToHex(msg.subarray(prefix.length + 1))).toBe(imageHash);
  });

  it("does not accept a signature over the bare hash (no cross-protocol replay)", async () => {
    // Someone tricks the device key into signing the raw 32 bytes in another context...
    const bare = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      device.privateKey,
      hexToBytes(imageHash),
    );
    // ...it is still useless as a TruthLens capture signature.
    expect(await verifyImageSignature(publicKeyHex, imageHash, bytesToHex(new Uint8Array(bare)))).toBe(false);
  });
});

describe("interoperability", () => {
  it("is standard ECDSA: OpenSSL (Node's crypto module) verifies the browser's signature", async () => {
    const sig = await signImageHash(device.privateKey, imageHash);
    const jwk = await crypto.subtle.exportKey("jwk", device.publicKey);
    const opensslKey = createPublicKey({ key: jwk as import("node:crypto").JsonWebKey, format: "jwk" });

    const ok = nodeVerify(
      "sha256",
      captureMessage(imageHash),
      { key: opensslKey, dsaEncoding: "ieee-p1363" }, // raw r ‖ s, as Web Crypto produces
      hexToBytes(sig),
    );
    expect(ok).toBe(true);
  });
});
