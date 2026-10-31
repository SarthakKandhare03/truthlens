// Themed 404 for any URL that doesn't match a page.
// Rendered inside the root layout (no site nav), so it carries its own brand link.
import Link from "next/link";
import { Compass } from "lucide-react";
import { BrandMark, Wordmark } from "@/components/ui/brand";
import { primaryAction, secondaryAction, StateCard } from "@/components/ui/state-card";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-16">
      <Link href="/" className="flex items-center gap-2.5">
        <BrandMark className="size-7" />
        <Wordmark />
      </Link>
      <StateCard
        icon={<Compass />}
        eyebrow="Error 404 · no record"
        title="This page has no provenance."
        actions={
          <>
            <Link href="/" className={primaryAction}>
              Back to the index
            </Link>
            <Link href="/explorer" className={secondaryAction}>
              Read the ledger
            </Link>
          </>
        }
      >
        There&apos;s nothing at this address. If you followed a provenance link, check that the full 64-character hash
        was copied.
      </StateCard>
    </main>
  );
}
