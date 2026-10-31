// SHA-256 and byte-encoding helpers.
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { bytesToHex, concatBytes, hexToBytes, isHexOfLength, toBytes } from "@/lib/crypto/encoding";

describe("encoding", () => {
  it("round-trips bytes through 0x-hex", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
    expect(bytesToHex(bytes)).toBe("0x00010f107f80ff");
    expect(hexToBytes("0x00010f107f80ff")).toEqual(bytes);
    expect(hexToBytes("00010f107f80ff")).toEqual(bytes); // prefix optional on input
  });

  it("rejects malformed hex instead of silently producing garbage", () => {
    expect(() => hexToBytes("0x123")).toThrow(); // odd length
    expect(() => hexToBytes("0xzz")).toThrow(); // not hex
  });

  it("checks exact byte length", () => {
    expect(isHexOfLength("0x" + "ab".repeat(32), 32)).toBe(true);
    expect(isHexOfLength("0x" + "ab".repeat(31), 32)).toBe(false);
    expect(isHexOfLength("ab".repeat(32), 32)).toBe(false); // missing 0x
    expect(isHexOfLength(42, 32)).toBe(false);
  });

  it("concatenates and copies views without leaking neighbouring bytes", () => {
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual(new Uint8Array([1, 2, 3]));
    const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
    expect(toBytes(big.subarray(2, 5))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("sha256Hex", () => {
  it("matches the official NIST test vectors", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with Node's OpenSSL implementation on random data", async () => {
    for (let i = 0; i < 5; i++) {
      const data = randomBytes(1000 + i * 4096);
      expect(await sha256Hex(data)).toBe("0x" + createHash("sha256").update(data).digest("hex"));
    }
  });

  it("hashes only the viewed bytes of a Buffer/subarray", async () => {
    const big = Buffer.from("xxhello worldxx");
    expect(await sha256Hex(big.subarray(2, 13))).toBe(await sha256Hex(Buffer.from("hello world")));
  });

  it("avalanche effect: flipping ONE bit changes about half of the 256 output bits", async () => {
    const data = randomBytes(4096);
    const flipped = Buffer.from(data);
    flipped[100] ^= 0b00000001;

    const a = BigInt(await sha256Hex(data));
    const b = BigInt(await sha256Hex(flipped));
    const differingBits = (a ^ b).toString(2).replace(/0/g, "").length;
    // Expected ≈128 ± 8. This is why an exact-hash match proves "not one bit changed".
    expect(differingBits).toBeGreaterThan(90);
    expect(differingBits).toBeLessThan(166);
  });
});
