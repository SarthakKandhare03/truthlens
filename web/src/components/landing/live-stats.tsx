"use client";

// "Images secured / Blocks written / Edits tracked": big serif numerals in a
// ruled table. Rendered on the server with the real numbers, then refreshed
// every few seconds, so sealing a photo on a phone ticks them up live on the
// projector during the demo.
import { useEffect, useState } from "react";
import type { StatsResponse } from "@/lib/api-types";
import { CountUp } from "@/components/ui/count-up";
import { label } from "@/components/ui/styles";

const POLL_MS = 6000;

export function LiveStats({ initial }: { initial: StatsResponse | null }) {
  const [stats, setStats] = useState(initial);
  const [online, setOnline] = useState(initial !== null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as StatsResponse;
        if (!stopped) {
          setStats(next);
          setOnline(true);
        }
      } catch {
        if (!stopped) setOnline(false);
      }
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const items = [
    { label: "Images secured", value: stats?.totalRecords ?? 0 },
    { label: "Blocks written", value: stats?.latestBlock ?? 0 },
    { label: "Edits tracked", value: stats?.editsTracked ?? 0 },
  ];

  return (
    <div>
      <div className="grid grid-cols-3 divide-x divide-rule border-y border-ink">
        {items.map((it) => (
          <div key={it.label} className="px-3 py-5 sm:px-6">
            <p className="font-display text-5xl leading-none tabular-nums sm:text-7xl">
              <CountUp value={it.value} decimals={0} durationS={1.8} grouping />
            </p>
            <p className={`mt-2 ${label}`}>{it.label}</p>
          </div>
        ))}
      </div>
      <p className={`mt-3 flex items-center gap-2 ${label}`}>
        <span className={`size-2 ${online ? "animate-pulse-dot bg-signal" : "bg-fake"}`} />
        {online && stats ? `Live from ${stats.network.name} · chain ${stats.network.chainId}` : "Ledger offline"}
      </p>
    </div>
  );
}
