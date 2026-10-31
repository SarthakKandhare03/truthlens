"use client"; // error boundaries must be Client Components

// Catches crashes in any site page (home, verify, explorer, timeline). It sits
// inside the site layout, so the navigation bar stays usable.
import { ErrorView } from "@/components/ui/error-view";

export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
