// Landing page: the "night shift" hero with its evidence board, live ledger
// counters, a ticker of the latest seals, crossing caution tapes, then
// method, verdicts and scope.
//
// The page shell is prerendered (static, instant). The live counters, the
// evidence tag and the ticker are read from the chain per request and streamed in (Cache
// Components + Suspense), so a slow or stopped chain never blocks the page.
import { Suspense } from "react";
import { connection } from "next/server";
import { EvidenceTag } from "@/components/landing/evidence-board";
import { Hero, StatsSkeleton } from "@/components/landing/hero";
import { LiveStats } from "@/components/landing/live-stats";
import { FinalCta, HonestScope, HowItWorks, Verdicts } from "@/components/landing/sections";
import { Ticker } from "@/components/landing/ticker";
import { VelocityMarquee } from "@/components/landing/velocity-marquee";
import { getIndex } from "@/lib/server/image-index";
import { getStats } from "@/lib/server/stats";

export default function Home() {
  return (
    <>
      <Hero
        stats={
          <Suspense fallback={<StatsSkeleton />}>
            <StatsLoader />
          </Suspense>
        }
        tag={
          <Suspense fallback={<EvidenceTag />}>
            <TagLoader />
          </Suspense>
        }
      />
      <div className="mt-16">
        <Suspense fallback={<Ticker initial={[]} renderedAt={0} />}>
          <TickerLoader />
        </Suspense>
        <VelocityMarquee />
      </div>
      <HowItWorks />
      <Verdicts />
      <HonestScope />
      <FinalCta />
    </>
  );
}

async function StatsLoader() {
  await connection(); // read the chain at request time, never at build time
  const stats = await getStats().catch(() => null); // chain offline → "offline" badge, page still works
  return <LiveStats initial={stats} />;
}

/** The newest seal on the ledger, typed onto the hero's evidence tag. */
async function TagLoader() {
  await connection();
  const [latest] = await getStats()
    .then(() => getIndex().recent(1))
    .catch(() => []);
  return <EvidenceTag sha256={latest?.sha256} block={latest?.blockNumber} />;
}

async function TickerLoader() {
  await connection();
  const data = await loadTicker();
  return <Ticker initial={data.items} renderedAt={data.renderedAt} />;
}

/** Newest registrations (getStats has already synced the cache from the chain). */
async function loadTicker() {
  const items = await getStats()
    .then(() => getIndex().recent(12))
    .catch(() => []);
  return { items, renderedAt: Date.now() };
}
