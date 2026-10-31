// Live counters for the landing page and the explorer header.
// Shared by GET /api/stats and the landing page's server render.
import "server-only";
import type { StatsResponse } from "../api-types";
import { getChain, readTotalRecords } from "./chain";
import { getIndex, syncIndex } from "./image-index";

export async function getStats(): Promise<StatsResponse> {
  const { provider, network } = await getChain();
  const [totalRecords, latestBlock] = await Promise.all([readTotalRecords(), provider.getBlockNumber(), syncIndex()]);
  return { totalRecords, latestBlock, editsTracked: getIndex().countEdits(), network };
}
