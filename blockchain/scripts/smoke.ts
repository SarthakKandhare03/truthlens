// Smoke test against a RUNNING node: registers one sample record on the deployed
// TruthRegistry and reads it back. It proves the deploy file, the relayer
// account and the contract all line up before any web code is involved.
//
//   npm run smoke:local      (after `npm run node` + `npm run deploy:local`)
//
// Note: this writes a real record, so run it on localhost only. Restarting the
// local node wipes the chain.
import { network } from "hardhat";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

const { ethers, networkName } = await network.create();
const deployment = JSON.parse(
  await readFile(new URL(`../deployments/${networkName}.json`, import.meta.url), "utf8"),
);
const registry = await ethers.getContractAt("TruthRegistry", deployment.address);

// Fake image bytes, made unique per run so repeated runs don't hit AlreadyRegistered.
const imageBytes = ethers.toUtf8Bytes(`smoke-test-image ${Date.now()}`);
const sha256Hash = ethers.sha256(imageBytes);
const pHash = ethers.zeroPadBytes("0xc3a5f00f12345678", 32);

// A real P-256 device key, the same algorithm the browser will use.
const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const signerKeyHash = ethers.sha256(new Uint8Array(await webcrypto.subtle.exportKey("raw", keys.publicKey)));

console.log(`\nRegistering on ${networkName} @ ${deployment.address}`);
const tx = await registry.register(sha256Hash, pHash, signerKeyHash, "local://smoke-test.jpg");
const receipt = await tx.wait();
console.log(`  tx     ${tx.hash}`);
console.log(`  block  #${receipt!.blockNumber}`);

const rec = await registry.getRecord(sha256Hash);
console.log(`\nRead back getRecord(${sha256Hash.slice(0, 18)}…):`);
console.log(`  pHash          ${rec.pHash}`);
console.log(`  signerKeyHash  ${rec.signerKeyHash}`);
console.log(`  storageURI     ${rec.storageURI}`);
console.log(`  timestamp      ${new Date(Number(rec.timestamp) * 1000).toISOString()}`);
console.log(`  blockNumber    ${rec.blockNumber}`);
console.log(`\ntotalRecords() = ${await registry.totalRecords()}\n`);
