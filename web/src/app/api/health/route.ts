// GET /api/health: one-glance diagnosis of the whole backend. Open it in a
// browser before a demo: every check should say ok.
import { connection } from "next/server";
import { formatEther, Wallet } from "ethers";
import { getChain } from "@/lib/server/chain";
import { config } from "@/lib/server/config";
import { getIndex } from "@/lib/server/image-index";

type Check = { ok: boolean; detail: string };

async function check(fn: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  await connection();
  const checks: Record<string, Check> = {};

  checks.chain = await check(async () => {
    const { provider, network } = await getChain();
    return `${network.name} (chain ${network.chainId}), block #${await provider.getBlockNumber()}`;
  });

  checks.contract = await check(async () => {
    const { provider, network, reader } = await getChain();
    if ((await provider.getCode(network.contract)) === "0x") throw new Error(`No contract code at ${network.contract}. Redeploy.`);
    return `${network.contract}, ${await reader.totalRecords()} records`;
  });

  checks.relayer = await check(async () => {
    const { provider, network, reader } = await getChain();
    const address = new Wallet(config.relayerPrivateKey(network.chainId)).address;
    if (!(await reader.isRelayer(address))) throw new Error(`${address} is not an allow-listed relayer`);
    return `${address}, balance ${formatEther(await provider.getBalance(address))}`;
  });

  checks.storage = await check(async () =>
    config.storageDriver === "s3" ? `s3://${config.s3.bucket}` : config.storageLocalDir,
  );

  checks.index = await check(async () => `${getIndex().count()} records cached at ${config.databasePath}`);

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
