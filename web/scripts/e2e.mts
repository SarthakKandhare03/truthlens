// End-to-end check of the whole backend over real HTTP, against the running
// blockchain and web server. Plays the demo story and checks every outcome.
//
//   terminal 1: npm run chain        terminal 2: npm run deploy:local && npm run dev
//   terminal 3: npm run e2e
//
// Each run uses a freshly generated photo and device key, so it can be
// repeated as often as you like on the same chain.
import sharp from "sharp";
import { sha256Hex } from "../src/lib/crypto/hash";
import { generateDeviceKeyPair, exportPublicKey, signImageHash } from "../src/lib/crypto/signing";
import { computePHash } from "../src/lib/crypto/phash";
import { decodeImage } from "../src/lib/image/decode-node";
import type { MatchResponse, RegisterResponse, VerifyResponse, ProvenanceResponse, StatsResponse } from "../src/lib/api-types";
import { makeScene } from "../test/fixtures/scenes";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let failures = 0;

/** Short "status CODE" description of an API response, for check details. */
const got = (r: { status: number; body: { error?: { code: string } } }) =>
  `got ${r.status} ${r.body.error?.code ?? ""}`.trim() +
  (r.status === 429 ? " (rate limit: each run makes 7 registration attempts; wait a minute)" : "");

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
}

async function post(path: string, fields: Record<string, string | Uint8Array>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") form.set(k, v);
    else form.set(k, new Blob([v as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), "photo.jpg");
  }
  const res = await fetch(BASE + path, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

/** Prints the 16×16 heatmap grid as text: darker block = more of that cell changed. */
function printHeatmap(grid: number[], size: number) {
  const shades = [" ·", "░░", "▒▒", "▓▓", "██"];
  for (let r = 0; r < size; r++) {
    const row = grid.slice(r * size, (r + 1) * size).map((f) => shades[f === 0 ? 0 : Math.min(4, 1 + Math.floor(f * 4))]);
    console.log("      \x1b[33m" + row.join("") + "\x1b[0m");
  }
}

console.log(`\nTruthLens end-to-end check against ${BASE}\n`);

// --- 0. Health -----------------------------------------------------------------
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.log("  Cannot reach the web server. Is `npm run dev` running?\n");
  process.exit(1);
}
for (const [name, c] of Object.entries(health.checks as Record<string, { ok: boolean; detail: string }>)) {
  check(`health: ${name}`, c.ok, c.detail);
}
if (!health.ok) process.exit(1);

// --- 1. Capture: a new device key signs a new photo ---------------------------
console.log("\n1. Capture & register");
const device = await generateDeviceKeyPair();
const publicKey = await exportPublicKey(device.publicKey);
const seed = Math.floor(Math.random() * 1e9);
const photo = new Uint8Array(await makeScene(seed));
const sha256 = await sha256Hex(photo);
const signature = await signImageHash(device.privateKey, sha256);

const reg = await post("/api/register", { image: photo, publicKey, signature, sha256 });
const registered = reg.body as RegisterResponse;
check("register → 201", reg.status === 201, reg.status !== 201 ? got(reg) : `tx ${registered.txHash?.slice(0, 18)}… block #${registered.record?.blockNumber}`);
if (reg.status !== 201) {
  console.log(reg.body);
  process.exit(1);
}
console.log(`      timings (ms): ${JSON.stringify(registered.timings)}`);

// --- 2. Attacks on registration -------------------------------------------------
console.log("\n2. Registration rejects bad requests");
const dup = await post("/api/register", { image: photo, publicKey, signature });
check("same photo again → 409 ALREADY_REGISTERED", dup.status === 409 && dup.body.error.code === "ALREADY_REGISTERED", got(dup));

const intruder = await generateDeviceKeyPair();
const otherPhoto = new Uint8Array(await makeScene(seed + 1));
const forgedSig = await signImageHash(intruder.privateKey, await sha256Hex(otherPhoto));
const forged = await post("/api/register", { image: otherPhoto, publicKey, signature: forgedSig });
check("signature from a different key → 400 SIGNATURE_INVALID", forged.status === 400 && forged.body.error.code === "SIGNATURE_INVALID", got(forged));

const tampered = new Uint8Array(await sharp(otherPhoto).jpeg({ quality: 80 }).toBuffer());
const transit = await post("/api/register", {
  image: tampered,
  publicKey,
  signature: await signImageHash(device.privateKey, await sha256Hex(otherPhoto)),
  sha256: await sha256Hex(otherPhoto),
});
check("bytes changed in transit → 400 HASH_MISMATCH", transit.status === 400 && transit.body.error.code === "HASH_MISMATCH", got(transit));

const notImage = await post("/api/register", { image: new TextEncoder().encode("hello"), publicKey, signature });
check("non-image upload → 415 NOT_AN_IMAGE", notImage.status === 415, got(notImage));

// --- 3. Verify: the three verdicts ------------------------------------------------
console.log("\n3. Verify");
const v1 = (await post("/api/verify", { image: photo })).body as VerifyResponse;
check("original → AUTHENTIC", v1.verdict === "AUTHENTIC", v1.verdict === "AUTHENTIC" ? `signature ✓, block #${v1.record.blockNumber}` : JSON.stringify(v1));

const whatsapp = new Uint8Array(await sharp(photo).resize(1280).jpeg({ quality: 70 }).toBuffer());
const v2 = (await post("/api/verify", { image: whatsapp })).body as VerifyResponse;
check(
  "WhatsApp-style copy → EDITED (re-encoded, no visible change)",
  v2.verdict === "EDITED" && v2.editKind === "reencoded",
  v2.verdict === "EDITED" ? `pHash distance ${v2.distance}, ${v2.diff.changedPercent}% changed` : v2.verdict,
);

const patch = await sharp({ create: { width: 420, height: 320, channels: 3, background: "#ff2a6d" } }).png().toBuffer();
const edited = new Uint8Array(await sharp(photo).composite([{ input: patch, left: 980, top: 160 }]).jpeg({ quality: 90 }).toBuffer());
const v3 = (await post("/api/verify", { image: edited })).body as VerifyResponse;
check(
  "photo with pasted object → EDITED (modified) + heatmap",
  v3.verdict === "EDITED" && v3.editKind === "modified",
  v3.verdict === "EDITED" ? `${v3.diff.changedPercent}% of image modified, ${v3.diff.changedCells} cells` : v3.verdict,
);
if (v3.verdict === "EDITED") printHeatmap(v3.diff.grid, v3.diff.gridSize);

const v4 = (await post("/api/verify", { image: new Uint8Array(await makeScene(seed + 7)) })).body as VerifyResponse;
check("unrelated photo → UNVERIFIED (NO_RECORD)", v4.verdict === "UNVERIFIED" && v4.reason === "NO_RECORD", v4.verdict === "UNVERIFIED" ? `nearest pHash distance ${v4.nearestDistance}` : v4.verdict);

// --- 4. Provenance chain ------------------------------------------------------------
console.log("\n4. Provenance");
const editSha = await sha256Hex(edited);
const editReg = await post("/api/register", {
  image: edited,
  publicKey,
  signature: await signImageHash(device.privateKey, editSha),
  parentHash: sha256,
});
check("register the edit as a child of the original → 201", editReg.status === 201, `edit tx ${(editReg.body as RegisterResponse).editTxHash?.slice(0, 18)}…`);

const prov = (await fetch(`${BASE}/api/records/${editSha}`).then((r) => r.json())) as ProvenanceResponse;
check("provenance tree: original → edit", prov.root === sha256 && prov.nodes.length === 2 && prov.nodes[1]?.parentHash === sha256);

const v5 = (await post("/api/verify", { image: edited })).body as VerifyResponse;
check("the registered edit now verifies as AUTHENTIC itself", v5.verdict === "AUTHENTIC" && v5.record.parentHash === sha256);

// --- 5. Supporting endpoints ---------------------------------------------------------
console.log("\n5. Supporting endpoints");
const originalRes = await fetch(`${BASE}/api/images/${sha256}`);
const served = new Uint8Array(await originalRes.arrayBuffer());
check("GET /api/images/:sha → the exact original bytes", (await sha256Hex(served)) === sha256, originalRes.headers.get("cache-control") ?? "");

const feed = (await fetch(`${BASE}/api/feed?limit=5`).then((r) => r.json())) as { items: { sha256: string }[] };
check("GET /api/feed lists the new registrations", feed.items.some((i) => i.sha256 === editSha) && feed.items.some((i) => i.sha256 === sha256));

const search = (await fetch(`${BASE}/api/feed?q=${sha256.slice(0, 12)}`).then((r) => r.json())) as { items: { sha256: string }[] };
check("GET /api/feed?q=<hash prefix> finds it", search.items[0]?.sha256 === sha256);

// Live verify sends perceptual hashes only. The sealed photo's own pHash (as a
// camera crop would produce at best) must find its record; garbage must be refused.
const match = async (hashes: unknown) => {
  const res = await fetch(`${BASE}/api/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hashes }) });
  return { status: res.status, body: await res.json() };
};
const ownPHash = computePHash(await decodeImage(Buffer.from(photo)));
const m1 = (await match(["0x0000000000000000", ownPHash])).body as MatchResponse;
check("POST /api/match (live verify) finds the sealed photo from hashes alone", m1.record?.sha256 === sha256 && m1.best?.distance === 0);
const m2 = await match(["not-a-hash"]);
check("POST /api/match rejects malformed hashes → 400", m2.status === 400 && m2.body.error?.code === "BAD_HASHES", got(m2));

const stats = (await fetch(`${BASE}/api/stats`).then((r) => r.json())) as StatsResponse;
check("GET /api/stats", stats.totalRecords >= 2, `${stats.totalRecords} images secured, block #${stats.latestBlock}`);

console.log(
  failures
    ? `\n\x1b[31m${failures} check(s) failed\x1b[0m\n`
    : `\n\x1b[32mAll checks passed.\x1b[0m  Device key ${publicKey.slice(0, 14)}… registered 2 images.\n`,
);
process.exitCode = failures ? 1 : 0;
