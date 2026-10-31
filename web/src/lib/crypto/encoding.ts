// Byte <-> hex helpers shared by the hashing and signing code.
//
// Convention used across TruthLens: every hash, key and signature travels as a
// lowercase, 0x-prefixed hex string. That is the same format Solidity/ethers use
// for bytes32, so values can go to the contract without conversion.

/**
 * A byte array backed by a plain ArrayBuffer. Web Crypto's BufferSource type
 * rejects SharedArrayBuffer-backed views, so we use this narrower type everywhere.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const HEX_RE = /^(0x)?([0-9a-fA-F]{2})*$/;

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function hexToBytes(hex: string): Bytes {
  if (!HEX_RE.test(hex)) throw new Error(`Invalid hex string: ${hex.slice(0, 20)}…`);
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** True if `value` is 0x-prefixed hex encoding exactly `byteLength` bytes. */
export function isHexOfLength(value: unknown, byteLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length === 2 + byteLength * 2 &&
    /^0x[0-9a-fA-F]*$/.test(value)
  );
}

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text) as Bytes;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Copies any byte source (Node Buffer, ArrayBuffer, view on a shared buffer)
 * into a fresh `Bytes`, so it is always safe to hand to Web Crypto.
 */
export function toBytes(data: ArrayBuffer | ArrayBufferView): Bytes {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
}
