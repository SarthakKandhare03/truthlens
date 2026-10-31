"use client";

// Body of the route-level error boundaries (app/(site)/error.tsx,
// app/capture/error.tsx). Shows a friendly message and a "Try again" that
// re-renders the failed part of the page via Next.js's retry().
//
// Errors thrown on the server reach the browser as a generic message plus a
// `digest` id (Next.js hides details so internals never leak); the digest
// matches the entry in the server log, which is what you'd quote in a bug report.
import { useEffect } from "react";
import Link from "next/link";
import { RefreshCcw, TriangleAlert } from "lucide-react";
import { primaryAction, secondaryAction, StateCard } from "./state-card";

export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <StateCard
        icon={<TriangleAlert />}
        tone="danger"
        eyebrow="Something went wrong"
        title="This part of TruthLens crashed"
        actions={
          <>
            <button type="button" onClick={() => retry()} className={primaryAction}>
              <RefreshCcw className="size-4" /> Try again
            </button>
            <Link href="/" className={secondaryAction}>
              Back home
            </Link>
          </>
        }
      >
        <p>
          Usually the blockchain node or the dev server was restarted. Check that <code className="text-ink">npm run chain</code>{" "}
          is running and the contract is deployed, then try again.
        </p>
        {digest && <p className="mt-3 font-mono text-[11px] text-muted">incident id {digest}</p>}
      </StateCard>
    </div>
  );
}
