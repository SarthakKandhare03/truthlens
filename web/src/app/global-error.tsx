"use client"; // error boundaries must be Client Components

// Last-resort error page, used only if the ROOT layout itself fails. It
// replaces the whole document, so it brings its own <html>, <body> and styles.
import "./globals.css";
import { ErrorView } from "@/components/ui/error-view";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>TruthLens: something went wrong</title>
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
