"use client";

// Provenance timeline, printed as a strip of film:
//   Captured → Registered on block #N → Edited version (block #M) → …
//
// Each stop is a frame on a dark film base with sprocket holes and Kodak-style
// edge printing (frame numbers). The strip unspools left to right; clicking a
// frame opens that record's full on-chain details below. Every value shown
// comes from the contract (via /api/records), not the cache.
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, ScanLine } from "lucide-react";
import type { ProvenanceNode, ProvenanceResponse } from "@/lib/api-types";
import { formatChainTime, shortHash, txExplorerUrl } from "@/lib/client/format";
import { CropFrame } from "@/components/ui/crop-frame";
import { DetailRow, HashChip } from "@/components/ui/hash-chip";
import { btnSecondary, label } from "@/components/ui/styles";
import { Thumb } from "@/components/ui/thumb";

type StopKind = "captured" | "registered" | "edited";
type Stop = { key: string; kind: StopKind; node: ProvenanceNode; title: string; sub: string };

const FRAME_W = 200; // px per frame, so the strip scrolls sideways on phones
const GAP = 16;
const STEP_S = 0.4; // seconds between frames appearing

// The film itself is always "film coloured", whatever the page theme.
const FILM = "#1c1a16";
const EDGE_PRINT = "#e8a33a";

function buildStops(nodes: ProvenanceNode[]): Stop[] {
  const sorted = [...nodes].sort((a, b) => a.index - b.index); // chain order
  const stops: Stop[] = [];
  let edits = 0;
  for (const node of sorted) {
    if (node.depth === 0) {
      stops.push({ key: `${node.sha256}-c`, kind: "captured", node, title: "Captured", sub: "signed on device" });
      stops.push({ key: `${node.sha256}-r`, kind: "registered", node, title: "Registered", sub: `block #${node.blockNumber}` });
    } else {
      edits++;
      const prev = stops[stops.length - 1]?.node;
      stops.push({
        key: node.sha256,
        kind: "edited",
        node,
        title: `Edited version ${edits}`,
        // Mention the parent only when it isn't the frame right before (a branch).
        sub: prev && node.parentHash !== prev.sha256 ? `edit of ${shortHash(node.parentHash ?? "", 4, 3)}` : `block #${node.blockNumber}`,
      });
    }
  }
  return stops;
}

/** A row of sprocket holes: paper-coloured gaps punched through the film. */
function Sprockets() {
  return (
    <div
      aria-hidden
      className="h-2.5"
      style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 9px, var(--paper) 9px 21px, transparent 21px 30px)" }}
    />
  );
}

export function ProvenanceTimeline({ data }: { data: ProvenanceResponse }) {
  const stops = useMemo(() => buildStops(data.nodes), [data.nodes]);
  const [selected, setSelected] = useState(data.focus);
  const root = data.nodes.find((n) => n.sha256 === data.root)!;
  const node = data.nodes.find((n) => n.sha256 === selected) ?? root;
  const editCount = data.nodes.length - 1;
  const stripW = stops.length * FRAME_W + (stops.length - 1) * GAP;
  const frameNo = (i: number) => `${String(i + 1).padStart(2, "0")}A`;

  return (
    <div className="space-y-10">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className={`flex justify-between border-b border-ink pb-3 ${label}`}>
          <span>§ Provenance — chain of custody</span>
          <span>N° {data.root.slice(2, 8).toUpperCase()}</span>
        </div>
        <h1 className="mt-6 font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl">
          The life of this <em className="text-signal">image</em>
        </h1>
        {/* suppressHydrationWarning: a server in another timezone renders a different clock time */}
        <p className="mt-4 text-muted" suppressHydrationWarning>
          Captured {formatChainTime(root.timestamp)} ·{" "}
          {editCount === 0 ? "no registered edits" : `${editCount} registered edit${editCount > 1 ? "s" : ""}`} ·{" "}
          {data.network.name}
        </p>
      </motion.header>

      {/* The film strip */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="mx-auto" style={{ width: stripW + 48 }}>
          <motion.div
            className="px-6 py-2"
            style={{ backgroundColor: FILM }}
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ duration: Math.max(0.6, STEP_S * stops.length), ease: [0.65, 0, 0.35, 1] }}
          >
            <Sprockets />
            <div className="flex justify-between py-1 font-mono text-[9px] tracking-[0.3em]" style={{ color: EDGE_PRINT }}>
              <span>TRUTHLENS SAFETY FILM</span>
              <span>◂ SHA-256 ▸</span>
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {stops.map((stop, i) => {
                const active = stop.node.sha256 === node.sha256;
                return (
                  <motion.button
                    key={stop.key}
                    type="button"
                    onClick={() => setSelected(stop.node.sha256)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 + i * STEP_S }}
                    className="group shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    style={{ width: FRAME_W }}
                    aria-pressed={active}
                    aria-label={`${stop.title}, ${stop.sub}`}
                    data-cursor="View"
                  >
                    <div
                      className={`aspect-[4/3] overflow-hidden border-2 transition-colors ${
                        active ? "border-signal" : "border-transparent group-hover:border-[#ece7dc]/40"
                      }`}
                    >
                      {stop.kind === "registered" ? (
                        <div className="flex size-full flex-col items-center justify-center bg-black/40 text-[#ece7dc]">
                          <span className="font-mono text-[9px] tracking-[0.3em] opacity-70">BLOCK</span>
                          <span className="font-display text-5xl leading-none">#{stop.node.blockNumber}</span>
                        </div>
                      ) : (
                        <Thumb sha256={stop.node.sha256} width={320} className="size-full" />
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[9px] tracking-[0.3em]" style={{ color: EDGE_PRINT }}>
                      ▸ {frameNo(i)}
                    </p>
                  </motion.button>
                );
              })}
            </div>
            <Sprockets />
          </motion.div>

          {/* Captions under each frame */}
          <div className="mt-3 flex px-6" style={{ gap: GAP }}>
            {stops.map((stop, i) => {
              // The root record has two frames (Captured, Registered); mark only one.
              const focus = stop.node.sha256 === data.focus && stop.kind !== "captured";
              return (
                <motion.div
                  key={stop.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * STEP_S }}
                  className="shrink-0"
                  style={{ width: FRAME_W }}
                >
                  <p className={`font-display text-2xl leading-tight ${stop.kind === "edited" ? "text-edited" : ""}`}>{stop.title}</p>
                  <p className="font-mono text-[11px] text-muted">{stop.sub}</p>
                  {focus && (
                    <p className="mt-1 inline-block bg-signal px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-ink">
                      you are here
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Details of the selected record */}
      <AnimatePresence mode="wait">
        <motion.section
          key={node.sha256}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="border border-ink bg-sheet"
        >
          <header className={`flex justify-between border-b border-ink px-5 py-2.5 ${label}`}>
            <span>{node.depth === 0 ? "Original capture" : `Edited version · depth ${node.depth}`}</span>
            <span>Block #{node.blockNumber}</span>
          </header>
          <div className="grid gap-8 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <CropFrame>
                {/* Fixed 4:3 frame so the layout doesn't jump while the thumbnail loads */}
                <div className="aspect-[4/3] overflow-hidden border border-ink bg-paper">
                  <Thumb
                    sha256={node.sha256}
                    width={640}
                    alt={node.depth === 0 ? "Original capture" : "Edited version"}
                    className="size-full"
                    fit="contain"
                  />
                </div>
              </CropFrame>
              <div className="mt-5 flex flex-wrap gap-2">
                <a href={`/api/images/${node.sha256}`} target="_blank" rel="noreferrer" className={btnSecondary}>
                  <ExternalLink className="size-4" /> Full-size original
                </a>
                <Link href="/verify" className={btnSecondary}>
                  <ScanLine className="size-4" /> Verify a copy
                </Link>
              </div>
            </div>
            <div>
              <p className={`font-display text-4xl leading-tight ${node.depth === 0 ? "" : "text-edited"}`}>
                {node.depth === 0 ? "The original." : "An edit."}
              </p>
              <p className="mt-2 text-muted">
                {node.depth === 0
                  ? "The first record in this chain: signed on the capturing device and sealed on-chain."
                  : node.signerKeyHash === root.signerKeyHash
                    ? "Signed by the same device that captured the original."
                    : "Signed by a different device than the original."}
              </p>
              <dl className="mt-5 border-t border-ink">
                <DetailRow label="Block">#{node.blockNumber}</DetailRow>
                <DetailRow label="Sealed">{formatChainTime(node.timestamp)}</DetailRow>
                {node.txHash && (
                  <DetailRow label="Tx">
                    {txExplorerUrl(data.network.chainId, node.txHash) ? (
                      <a href={txExplorerUrl(data.network.chainId, node.txHash)!} target="_blank" rel="noreferrer" className="text-signal underline">
                        <HashChip value={node.txHash} />
                      </a>
                    ) : (
                      <HashChip value={node.txHash} />
                    )}
                  </DetailRow>
                )}
                <DetailRow label="SHA-256">
                  <HashChip value={node.sha256} />
                </DetailRow>
                <DetailRow label="pHash">
                  <HashChip value={node.pHash} />
                </DetailRow>
                <DetailRow label="Device key">
                  <HashChip value={node.signerKeyHash} />
                </DetailRow>
                <DetailRow label="Relayer">
                  <HashChip value={node.registrar} />
                </DetailRow>
                {node.parentHash && (
                  <DetailRow label="Edit of">
                    <button onClick={() => setSelected(node.parentHash!)} className="text-signal underline">
                      {shortHash(node.parentHash)}
                    </button>
                  </DetailRow>
                )}
                <DetailRow label="Edits of this">{node.children.length}</DetailRow>
              </dl>
            </div>
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
