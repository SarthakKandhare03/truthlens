"use client";

// A hash/address in monospace, shortened, with a one-click copy button.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { shortHash } from "@/lib/client/format";

export function HashChip({ value, full = false, className = "" }: { value: string; full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); copying is optional.
    }
  }

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 font-mono ${className}`}>
      <span className={full ? "break-all" : "truncate"} title={value}>
        {full ? value : shortHash(value)}
      </span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 p-0.5 text-muted transition hover:text-signal outline-none focus-visible:ring-2 focus-visible:ring-signal"
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? <Check className="size-3.5 text-authentic" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

/** Label / value row of a ruled "record" table, used in the report cards. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5 last:border-0">
      <dt className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-sm text-ink">{children}</dd>
    </div>
  );
}
