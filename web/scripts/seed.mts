// Fills a freshly started chain with sample data, so the landing counters,
// explorer and timeline aren't empty at the start of a demo.
//
//   npm run seed        (with `npm run chain`, `npm run deploy:local` and `npm run dev` running)
//
// Registers, through the real API (signatures and all):
//   - device A ("newsroom camera"): 3 photos, one of them with an edit chain
//     original → cropped version → cropped + captioned version
//   - device B ("field reporter"): 1 photo
// Every run uses fresh photos, so it can be run again safely.
import sharp from "sharp";
import { sha256Hex } from "../src/lib/crypto/hash";
import { exportPublicKey, generateDeviceKeyPair, signImageHash } from "../src/lib/crypto/signing";
import type { RegisterResponse } from "../src/lib/api-types";
import { makeScene } from "../test/fixtures/scenes";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";

type Device = { name: string; privateKey: CryptoKey; publicKey: string };

async function newDevice(name: string): Promise<Device> {
  const pair = await generateDeviceKeyPair();
  return { name, privateKey: pair.privateKey, publicKey: await exportPublicKey(pair.publicKey) };
}

/** Signs `bytes` with the device key and registers them, exactly like the Capture page does. */
async function register(device: Device, bytes: Uint8Array, label: string, parentHash?: string): Promise<RegisterResponse> {
  const sha256 = await sha256Hex(bytes);
  const form = new FormData();
  form.set("image", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), "seed.jpg");
  form.set("publicKey", device.publicKey);
  form.set("signature", await signImageHash(device.privateKey, sha256));
  form.set("sha256", sha256);
  if (parentHash) form.set("parentHash", parentHash);

  const res = await fetch(`${BASE}/api/register`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`${label}: ${res.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`);
  const r = body as RegisterResponse;
  console.log(`  ✓ ${label.padEnd(38)} block #${r.record.blockNumber}  ${r.record.sha256.slice(0, 14)}…  (${device.name})`);
  return r;
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.log("\nThe backend isn't ready. Start `npm run chain`, `npm run deploy:local` and `npm run dev`, then retry.\n");
  process.exitCode = 1;
} else {
  console.log(`\nSeeding ${BASE}\n`);
  const newsroom = await newDevice("newsroom camera");
  const reporter = await newDevice("field reporter");
  const seed = Math.floor(Math.random() * 1e9);
  const photo = async (i: number) => new Uint8Array(await makeScene(seed + i));

  // An original, a cropped edit of it, and a captioned edit of the crop.
  const original = await photo(0);
  const o = await register(newsroom, original, "Original photo");
  const { width = 1600, height = 1200 } = await sharp(original).metadata();
  const cropped = new Uint8Array(
    await sharp(original)
      .extract({ left: Math.round(width * 0.1), top: Math.round(height * 0.1), width: Math.round(width * 0.8), height: Math.round(height * 0.8) })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
  const c = await register(newsroom, cropped, "Edit 1: cropped", o.record.sha256);
  const cw = Math.round(width * 0.8);
  const ch = Math.round(height * 0.8);
  const caption = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect x="0" y="${ch * 0.82}" width="${cw}" height="${ch * 0.18}" fill="rgba(0,0,0,0.55)"/><text x="${cw * 0.04}" y="${ch * 0.94}" font-family="Arial" font-weight="700" font-size="${ch * 0.08}" fill="#fff">CITY CENTRE · 14:02</text></svg>`,
  );
  await register(newsroom, new Uint8Array(await sharp(cropped).composite([{ input: caption }]).jpeg({ quality: 90 }).toBuffer()), "Edit 2: cropped + caption", c.record.sha256);

  await register(newsroom, await photo(1), "Another original");
  await register(newsroom, await photo(2), "Another original");
  await register(reporter, await photo(3), "Original from a second device");

  console.log(`\nDone. Open the edit chain's timeline:\n  ${BASE}/provenance/${o.record.sha256}\n  ${BASE}/explorer\n`);
}
