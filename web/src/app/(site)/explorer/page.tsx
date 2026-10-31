// /explorer: live feed of on-chain registrations, with search.
// The first page of blocks is rendered on the server (no empty flash), then the
// client keeps it live by polling.
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ExplorerView } from "@/components/explorer/explorer-view";
import { getIndex, syncIndex } from "@/lib/server/image-index";
import { getStats } from "@/lib/server/stats";

export const metadata: Metadata = { title: "Explorer · TruthLens" };

export default function ExplorerPage() {
  return (
    <Suspense fallback={<ExplorerSkeleton />}>
      <ExplorerLoader />
    </Suspense>
  );
}

async function ExplorerLoader() {
  await connection();
  const data = await loadExplorerData();
  return <ExplorerView initialItems={data.items} initialStats={data.stats} renderedAt={data.renderedAt} />;
}

/** First page of blocks + stats. Chain offline → empty, and the page shows an "offline" state. */
async function loadExplorerData() {
  const stats = await getStats().catch(() => null);
  const items = stats ? await syncIndex().then(() => getIndex().recent(20)).catch(() => []) : [];
  return { stats, items, renderedAt: Date.now() };
}

function ExplorerSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy>
      <div className="h-28 w-2/3 animate-pulse bg-ink/[0.06]" />
      <div className="h-20 animate-pulse bg-ink/[0.06]" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse bg-ink/[0.06]" />
      ))}
    </div>
  );
}
