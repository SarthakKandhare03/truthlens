// End-to-end capture proof: capture → sign → (later) verify against chain values.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createCaptureProof, checkCaptureProof, type CaptureProof } from "@/lib/crypto/proof";
import { exportPublicKey, generateDeviceKeyPair, publicKeyFingerprint, signImageHash } from "@/lib/crypto/signing";
import { decodeImage } from "@/lib/image/decode-node";
import { sha256Hex } from "@/lib/crypto/hash";
import { makeScene } from "../fixtures/scenes";

let photo: Buffer;
let proof: CaptureProof;
/** What the blockchain would hold for this photo after registration. */
let onChain: { sha256: string; signerKeyHash: string };

beforeAll(async () => {
  photo = await makeScene(4);
  const pair = await generateDeviceKeyPair();
  const publicKeyHex = await exportPublicKey(pair.publicKey);
  proof = await createCaptureProof(photo, await decodeImage(photo), {
    privateKey: pair.privateKey,
    publicKeyHex,
    keyFingerprint: await publicKeyFingerprint(publicKeyHex),
  });
  onChain = { sha256: proof.sha256, signerKeyHash: proof.signerKeyHash };
});

describe("createCaptureProof", () => {
  it("bundles the exact hash, perceptual hash, public key and signature", async () => {
    expect(proof.sha256).toBe(await sha256Hex(photo));
    expect(proof.pHash).toMatch(/^0x[0-9a-f]{16}$/);
    expect(proof.signerKeyHash).toBe(await publicKeyFingerprint(proof.publicKey));
    expect(proof.signature).toMatch(/^0x[0-9a-f]{128}$/);
  });
});

describe("checkCaptureProof", () => {
  it("AUTHENTIC path: untouched bytes + matching key + valid signature", async () => {
    expect(await checkCaptureProof(photo, proof, onChain)).toEqual({
      hashMatchesBytes: true,
      keyMatchesFingerprint: true,
      signatureValid: true,
      valid: true,
    });
  });

  it("fails if the bytes changed at all, even a re-save that looks identical", async () => {
    const resaved = await sharp(photo).jpeg({ quality: 92 }).toBuffer();
    const result = await checkCaptureProof(resaved, proof, onChain);
    expect(result.hashMatchesBytes).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("fails if an attacker substitutes their own key and signature", async () => {
    // The attacker has the original photo and signs it with THEIR key, hoping
    // to claim it. The on-chain fingerprint pins the original device's key.
    const attacker = await generateDeviceKeyPair();
    const forged = {
      publicKey: await exportPublicKey(attacker.publicKey),
      signature: await signImageHash(attacker.privateKey, proof.sha256),
    };
    const result = await checkCaptureProof(photo, forged, onChain);
    expect(result.signatureValid).toBe(true); // mathematically valid for THEIR key…
    expect(result.keyMatchesFingerprint).toBe(false); // …but not the key on-chain
    expect(result.valid).toBe(false);
  });

  it("does not throw on garbage proof data", async () => {
    const result = await checkCaptureProof(photo, { publicKey: "0xnope", signature: "0x00" }, onChain);
    expect(result.valid).toBe(false);
  });
});
