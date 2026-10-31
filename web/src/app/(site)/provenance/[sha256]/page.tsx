// /provenance/:sha256: the provenance timeline of a registered image.
// The data is read from the chain per request and streamed in, so the page
// shell appears instantly.
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SearchX } from "lucide-react";
import { isHexOfLength } from "@/lib/crypto/encoding";
import { ServiceError } from "@/lib/server/errors";
import { getProvenance } from "@/lib/server/services/provenance";
import { ProvenanceTimeline } from "@/components/provenance/timeline";
import { primaryAction, StateCard } from "@/components/ui/state-card";

export const metadata: Metadata = { title: "Provenance · TruthLens" };

export default function ProvenancePage({ params }: PageProps<"/provenance/[sha256]">) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Suspense fallback={<TimelineSkeleton />}>
        <ProvenanceLoader params={params} />
      </Suspense>
    </div>
  );
}

async function ProvenanceLoader({ params }: { params: Promise<{ sha256: string }> }) {
  await connection();
  const sha256 = (await params).sha256.toLowerCase();
  if (!isHexOfLength(sha256, 32)) return <Message title="That isn't a SHA-256 hash" body="Provenance links look like /provenance/0x followed by 64 hex characters." />;

  // Only the data fetch sits in try/catch; rendering happens outside it.
  let data: Awaited<ReturnType<typeof getProvenance>> | null = null;
  let notFound = false;
  try {
    data = await getProvenance(sha256);
  } catch (err) {
    notFound = err instanceof ServiceError && err.status === 404;
  }

  if (data) return <ProvenanceTimeline data={data} />;
  if (notFound) {
    return <Message title="No provenance record" body="Nothing is registered on-chain under this hash. The image may never have been sealed with TruthLens." />;
  }
  return <Message title="Couldn't load the timeline" body="The blockchain node may be offline. Is `npm run chain` running?" />;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-10">
      <StateCard
        icon={<SearchX />}
        eyebrow="Provenance · no record"
        title={title}
        actions={
          <Link href="/explorer" className={primaryAction}>
            Read the ledger
          </Link>
        }
      >
        {body}
      </StateCard>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="h-24 w-2/3 animate-pulse bg-ink/[0.06]" />
      <div className="h-[300px] animate-pulse bg-ink/[0.06]" />
      <div className="h-[320px] animate-pulse bg-ink/[0.06]" />
    </div>
  );
}
