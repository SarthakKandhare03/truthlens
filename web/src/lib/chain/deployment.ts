// Loads the contract deployment written by blockchain/scripts/deploy.ts.
// CHAIN_NETWORK picks which file to read (localhost or amoy), so switching
// from the local node to the testnet is a one-line .env change.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Deployment = {
  contractName: string;
  network: string;
  chainId: number;
  address: string;
  deployer: string;
  txHash: string;
  deployBlock: number;
  deployedAt: string;
  abi: unknown[];
};

export function chainNetwork(): string {
  return process.env.CHAIN_NETWORK ?? "localhost";
}

/** Returns the deployment for the configured network, or null if not deployed yet. */
export async function loadDeployment(): Promise<Deployment | null> {
  const file = path.join(process.cwd(), "src/lib/chain/deployments", `${chainNetwork()}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Deployment;
  } catch {
    return null;
  }
}
