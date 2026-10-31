"use client";

// Ledger (the chain explorer): a live feed of registrations, written in as
// ruled ledger entries, newest first.
//
//   - Polls /api/feed and /api/stats every few seconds (only while the tab is
//     visible). New registrations drop in at the top with a glow, and older
//     blocks slide down (Framer Motion `layout` animations).
//   - Search by SHA-256 / tx hash prefix or "#block". Pressing Enter on a full
//     hash opens its provenance timeline.
//   - "Load older" pages backwards through the registration index.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { ArrowRight, Blocks, Camera, Loader, Search, X } from "lucide-react";
import type { ChainRecord, StatsResponse } from "@/lib/api-types";
import { isHexOfLength } from "@/lib/crypto/encoding";
import { shortHash, timeAgo, txExplorerUrl } from "@/lib/client/format";
import { HashChip } from "@/components/ui/hash-chip";
import { CountUp } from "@/components/ui/count-up";
import { Thumb } from "@/components/ui/thumb";
import { primaryAction, StateCard } from "@/components/ui/state-card";
import { btnSecondary, label } from "@/components/ui/styles";

const POLL_MS = 4000;
const PAGE = 20;

type Props = {
  initialItems: ChainRecord[];
  initialStats: StatsResponse | null;
  /** Server render time, so "42s ago" is identical in the server HTML and the first client render. */
  renderedAt: number;
};

export function ExplorerView({ initialItems, initialStats, renderedAt }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [stats, setStats] = useState(initialStats);
  const [online, setOnline] = useState(initialStats !== null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(renderedAt);
  const [hasOlder, setHasOlder] = useState(initialItems.length === PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChainRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const newest = useRef(initialItems[0]?.index ?? -1);

  // ---- Live polling -------------------------------------------------------
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const [feedRes, statsRes] = await Promise.all([fetch(`/api/feed?limit=${PAGE}`), fetch("/api/stats")]);
        if (!feedRes.ok || !statsRes.ok) throw new Error("offline");
        const feed = (await feedRes.json()) as { items: ChainRecord[] };
        const nextStats = (await statsRes.json()) as StatsResponse;
        if (stopped) return;
        setOnline(true);
        setStats(nextStats);
        setNow(Date.now());

        // A smaller newest index means the chain was reset (local node restart).
        const topIndex = feed.items[0]?.index ?? -1;
        if (topIndex < newest.current) {
          setItems(feed.items);
          newest.current = topIndex;
          return;
        }
        const arrived = feed.items.filter((i) => i.index > newest.current);
        if (arrived.length) {
          newest.current = topIndex;
          setItems((old) => [...arrived, ...old]);
          setFresh(new Set(arrived.map((i) => i.sha256)));
          setTimeout(() => !stopped && setFresh(new Set()), 2500);
        }
      } catch {
        if (!stopped) setOnline(false);
      }
    };
    const id = setInterval(() => document.visibilityState === "visible" && void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // ---- Search (debounced) ---------------------------------------------------
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/feed?q=${encodeURIComponent(q)}&limit=${PAGE}`);
        const body = (await res.json()) as { items?: ChainRecord[] };
        if (!cancelled) setResults(body.items ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) setResults(null); // back to the live feed
  };

  const loadOlder = useCallback(async () => {
    const oldest = items[items.length - 1]?.index;
    if (oldest === undefined) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/feed?limit=${PAGE}&before=${oldest}`);
      const body = (await res.json()) as { items: ChainRecord[] };
      setItems((old) => [...old, ...body.items]);
      setHasOlder(body.items.length === PAGE);
    } finally {
      setLoadingOlder(false);
    }
  }, [items]);

  const shown = results ?? items;
  const network = stats?.network;

  // Hover preview: the entry's photo floats beside the cursor. Motion values
  // carry the position, so moving the mouse never re-renders the list.
  const [preview, setPreview] = useState<ChainRecord | null>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const previewX = useSpring(px, { stiffness: 380, damping: 32 });
  const previewY = useSpring(py, { stiffness: 380, damping: 32 });
  const trackPointer = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    px.set(e.clientX + 28);
    py.set(e.clientY - 110);
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className={`flex items-center justify-between border-b border-ink pb-3 ${label}`}>
          <span>§ Ledger — TruthRegistry</span>
          <span className={`flex items-center gap-2 ${online ? "text-signal" : "text-fake"}`}>
            <span className={`size-2 ${online ? "animate-pulse-dot bg-signal" : "bg-fake"}`} />
            {online ? "live" : "offline"}
          </span>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl lg:col-span-8">
            Every seal, <em className="text-signal">block by block</em>
          </h1>
          <p className="self-end text-muted lg:col-span-4">
            Every photo registered on the TruthRegistry contract, newest first. New entries are written in as they are
            sealed.
          </p>
        </div>
      </motion.header>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 border-y border-ink sm:grid-cols-4 sm:divide-x sm:divide-rule">
        {[
          { label: "Images secured", value: stats?.totalRecords ?? 0 },
          { label: "Latest block", value: stats?.latestBlock ?? 0, prefix: "#" },
          { label: "Edits tracked", value: stats?.editsTracked ?? 0 },
        ].map((s) => (
          <div key={s.label} className="border-b border-rule px-0 py-4 sm:border-0 sm:px-5 sm:first:pl-0">
            <p className="font-display text-5xl leading-none tabular-nums">
              {s.prefix && <span className="text-3xl text-muted">{s.prefix}</span>}
              <CountUp value={s.value} decimals={0} grouping />
            </p>
            <p className={`mt-2 ${label}`}>{s.label}</p>
          </div>
        ))}
        <div className="min-w-0 py-4 sm:px-5">
          <p className="truncate pt-2 text-sm">{network ? <HashChip value={network.contract} /> : "—"}</p>
          <p className={`mt-2 ${label}`}>Contract · {network ? `${network.name} ${network.chainId}` : "offline"}</p>
        </div>
      </div>

      {/* Search */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim().toLowerCase();
          if (isHexOfLength(q, 32) && results?.some((r) => r.sha256 === q)) router.push(`/provenance/${q}`);
        }}
        className="mb-10 flex items-center gap-3 border-b-2 border-ink pb-2 focus-within:border-signal"
      >
        <Search className="size-5 shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by SHA-256, tx hash or #block"
          aria-label="Search registrations"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-2 font-mono text-base outline-none placeholder:text-muted/70"
        />
        {searching && <Loader className="size-4 animate-spin text-signal" />}
        {query && (
          <button type="button" onClick={() => onQueryChange("")} aria-label="Clear search" className="text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </form>

      {results && (
        <p className={`mb-4 ${label}`}>
          {results.length} result{results.length === 1 ? "" : "s"} for “{query.trim()}”
        </p>
      )}

      {/* The ledger */}
      {shown.length === 0 ? (
        <EmptyState searching={results !== null} online={online} />
      ) : (
        <>
          <div className={`hidden grid-cols-[6rem_7rem_1fr_7rem] gap-4 border-b border-ink pb-2 sm:grid ${label}`}>
            <span>Block</span>
            <span>Specimen</span>
            <span>Entry</span>
            <span className="text-right">Recorded</span>
          </div>
          <ol className="border-b border-ink" onPointerMove={trackPointer} onPointerLeave={() => setPreview(null)}>
            <AnimatePresence initial={false}>
              {shown.map((item) => (
                <motion.li
                  key={item.sha256}
                  layout
                  initial={{ opacity: 0, y: -24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="border-b border-rule last:border-0"
                  data-cursor="Open"
                  onPointerEnter={(e) => {
                    if (e.pointerType !== "mouse") return;
                    trackPointer(e);
                    setPreview(item);
                  }}
                >
                  <LedgerRow item={item} fresh={fresh.has(item.sha256)} now={now} chainId={network?.chainId ?? 31337} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </>
      )}

      {/* Floating preview of the hovered entry */}
      <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-50 hidden md:block" style={{ x: previewX, y: previewY }}>
        <AnimatePresence>
          {preview && (
            <motion.div
              key={preview.sha256}
              initial={{ opacity: 0, scale: 0.85, rotate: -4 }}
              animate={{ opacity: 1, scale: 1, rotate: -2 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 360, damping: 26 }}
              className="w-64 border border-ink bg-sheet p-2 shadow-[0_18px_40px_rgb(0_0_0/0.3)]"
            >
              <Thumb sha256={preview.sha256} width={320} className="aspect-[4/3] w-full" />
              <p className="mt-2 flex justify-between font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
                <span>Block #{preview.blockNumber}</span>
                <span className={preview.parentHash ? "text-edited" : "text-authentic"}>{preview.parentHash ? "edit" : "original"}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {!results && hasOlder && items.length > 0 && (
        <div className="mt-8 text-center">
          <button onClick={loadOlder} disabled={loadingOlder} className={btnSecondary}>
            {loadingOlder ? "Loading…" : "Load older entries"}
          </button>
        </div>
      )}
    </div>
  );
}

function LedgerRow({ item, fresh, now, chainId }: { item: ChainRecord; fresh: boolean; now: number; chainId: number }) {
  const isEdit = item.parentHash !== null;
  const explorer = txExplorerUrl(chainId, item.txHash);

  return (
    <motion.div
      // A fresh entry is "written in": a wash of the accent colour that fades out.
      animate={{
        backgroundColor: fresh
          ? ["color-mix(in srgb, var(--signal) 0%, transparent)", "color-mix(in srgb, var(--signal) 18%, transparent)", "color-mix(in srgb, var(--signal) 0%, transparent)"]
          : "color-mix(in srgb, var(--signal) 0%, transparent)",
      }}
      transition={{ duration: 2.4 }}
      className="grid grid-cols-[4.5rem_1fr] items-start gap-4 py-4 sm:grid-cols-[6rem_7rem_1fr_7rem]"
    >
      <p className={`font-display text-4xl leading-none tabular-nums sm:text-5xl ${isEdit ? "text-edited" : ""}`}>
        <span className="text-xl text-muted">#</span>
        {item.blockNumber}
      </p>

      <Thumb sha256={item.sha256} width={160} className="hidden h-[4.5rem] w-28 border border-ink sm:flex" />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
              isEdit ? "border-edited text-edited" : "border-authentic text-authentic"
            }`}
          >
            {isEdit ? "Edit" : "Original"}
          </span>
          {isEdit && <span className="font-mono text-[11px] text-muted">of {shortHash(item.parentHash!, 4, 3)}</span>}
          <span className="ml-auto font-mono text-[11px] text-muted sm:hidden" suppressHydrationWarning>
            {timeAgo(item.timestamp, now)}
          </span>
        </div>
        <p className="mt-1.5 text-sm">
          <HashChip value={item.sha256} />
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          <span>key {shortHash(item.signerKeyHash, 4, 3)}</span>
          {item.txHash &&
            (explorer ? (
              <a href={explorer} target="_blank" rel="noreferrer" className="text-signal underline">
                tx {shortHash(item.txHash, 4, 3)}
              </a>
            ) : (
              <span>tx {shortHash(item.txHash, 4, 3)}</span>
            ))}
          <Link
            href={`/provenance/${item.sha256}`}
            className="group inline-flex items-center gap-1 uppercase tracking-[0.14em] text-signal"
          >
            Timeline <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      <p className="hidden text-right font-mono text-[11px] text-muted sm:block" suppressHydrationWarning>
        {timeAgo(item.timestamp, now)}
      </p>
    </motion.div>
  );
}

function EmptyState({ searching, online }: { searching: boolean; online: boolean }) {
  return (
    <StateCard
      icon={<Blocks />}
      eyebrow={searching ? "Search · no entries" : online ? "Ledger · empty" : "Ledger · offline"}
      title={searching ? "No entries match that search." : online ? "No photos sealed yet." : "The blockchain node is offline."}
      tone={online ? "neutral" : "danger"}
      actions={
        !searching && online ? (
          <Link href="/capture" className={primaryAction}>
            <Camera className="size-4" /> Capture a photo
          </Link>
        ) : undefined
      }
    >
      {searching
        ? "Try a longer hash prefix, a tx hash, or a block number like #12."
        : online
          ? "Capture a photo and watch its entry get written in here."
          : "Start it with `npm run chain`, then deploy with `npm run deploy:local`."}
    </StateCard>
  );
}
