// Deploys TruthRegistry and records where it lives.
//
//   Local:  npm run node            (terminal 1, keep it running)
//           npm run deploy:local    (terminal 2)
//   Amoy:   fill in .env, then      npm run deploy:amoy
//
// Output: deployments/<network>.json containing the address, chain id,
// deployment block and ABI. The same file is copied into the web app
// (web/src/lib/chain/deployments/) so the backend relayer knows which contract
// to talk to without anyone copy-pasting addresses by hand.
import { network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const blockchainDir = path.resolve(here, "..");
const webDeploymentsDir = path.resolve(blockchainDir, "../web/src/lib/chain/deployments");

const { ethers, networkName } = await network.create();

const [deployer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();
const balance = await ethers.provider.getBalance(deployer.address);

console.log(`\nDeploying TruthRegistry`);
console.log(`  network   ${networkName} (chain id ${chainId})`);
console.log(`  deployer  ${deployer.address}`);
console.log(`  balance   ${ethers.formatEther(balance)} ETH/POL\n`);

const registry = await ethers.deployContract("TruthRegistry");
const deployTx = registry.deploymentTransaction();
await registry.waitForDeployment();
const receipt = await deployTx!.wait();
const address = await registry.getAddress();

console.log(`  contract  ${address}`);
console.log(`  tx        ${deployTx!.hash}`);
console.log(`  block     #${receipt!.blockNumber}`);

// Optionally allow-list a separate relayer wallet. By default the deployer is
// already a relayer (see the contract constructor), which is fine for a demo.
const relayer = process.env.RELAYER_ADDRESS?.trim();
if (relayer && relayer.toLowerCase() !== deployer.address.toLowerCase()) {
  if (!ethers.isAddress(relayer)) throw new Error(`RELAYER_ADDRESS is not a valid address: ${relayer}`);
  await (await registry.setRelayer(relayer, true)).wait();
  console.log(`  relayer   ${relayer} allow-listed`);
}

const deployment = {
  contractName: "TruthRegistry",
  network: networkName,
  chainId: Number(chainId),
  address,
  deployer: deployer.address,
  txHash: deployTx!.hash,
  // The backend starts scanning events from this block instead of block 0.
  deployBlock: receipt!.blockNumber,
  deployedAt: new Date().toISOString(),
  abi: JSON.parse(registry.interface.formatJson()),
};

const json = JSON.stringify(deployment, null, 2) + "\n";
for (const dir of [path.join(blockchainDir, "deployments"), webDeploymentsDir]) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${networkName}.json`);
  await writeFile(file, json);
  console.log(`  wrote     ${path.relative(path.resolve(blockchainDir, ".."), file)}`);
}

// A quick read-back proves the contract is live and answering calls.
console.log(`\nSanity check: totalRecords() = ${await registry.totalRecords()}`);
console.log(`Done.\n`);
