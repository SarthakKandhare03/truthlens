"use client"; // error boundaries must be Client Components

// Catches crashes on the full-screen camera page.
import { ErrorView } from "@/components/ui/error-view";

export default function CaptureError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <ErrorView error={error} retry={retry} />
    </div>
  );
}
