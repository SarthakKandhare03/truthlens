"use client";

// A news-wire ticker of the latest seals, scrolling across the page in an ink
// band. Server-rendered with the newest registrations, then refreshed, so a
// photo sealed during the demo appears here within seconds.
//
// The list is rendered twice back to back and the strip is moved by exactly
// half its width, which makes the loop seamless.
import { useEffect, useState } from "react";
import type { ChainRecord } from "@/lib/api-types";
import { shortHash, timeAgo } from "@/lib/client/format";

const POLL_MS = 8000;

export function Ticker({ initial, renderedAt }: { initial: ChainRecord[]; renderedAt: number }) {
  const [items, setItems] = useState(initial);
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/feed?limit=12");
        if (!res.ok) return;
        const body = (await res.json()) as { items: ChainRecord[] };
        if (!stopped) {
          setItems(body.items);
          setNow(Date.now());
        }
      } catch {
        // keep showing the last good list
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const entries =
    items.length > 0
      ? items.map((it) => ({
          key: it.sha256,
          text: `Sealed · block ${it.blockNumber} · ${shortHash(it.sha256)} · ${it.parentHash ? "edit" : "original"} · ${timeAgo(it.timestamp, now)}`,
        }))
      : [{ key: "empty", text: "Awaiting the first seal · capture a photo to write it to the ledger" }];

  // Repeat short lists so one copy is always wider than the screen.
  const run = Array.from({ length: Math.max(1, Math.ceil(8 / entries.length)) }, () => entries).flat();

  return (
    <div className="relative -mx-4 overflow-hidden border-y border-ink bg-ink py-3 text-paper sm:-mx-6" aria-label="Latest seals">
      <div
        className="animate-marquee flex w-max"
        style={{ ["--marquee-duration" as string]: `${Math.max(30, run.length * 6)}s` }}
      >
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {run.map((e, i) => (
              <li key={`${e.key}-${i}`} className="flex items-center whitespace-nowrap px-6 font-mono text-[12px] uppercase tracking-[0.18em]" suppressHydrationWarning>
                <span className="mr-6 inline-block size-2 rounded-full bg-alarm" />
                {e.text}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
