"use client";

// The right-hand panel on the Verify page, set as an examination report:
// "examination in progress" while the request runs, then one of three findings.
//
// Copy rule: be precise about what was proven. AUTHENTIC / EDITED prove
// provenance (origin + integrity). UNVERIFIED means "no record", never
// "proven fake". TruthLens does not run AI deepfake detection.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { ChainRecord, NetworkInfo, VerifyResponse } from "@/lib/api-types";
import type { ProofCheck } from "@/lib/crypto/proof";
import { PHASH_MATCH_THRESHOLD } from "@/lib/crypto/phash";
import { formatChainTime, txExplorerUrl } from "@/lib/client/format";
import { CountUp } from "@/components/ui/count-up";
import { DetailRow, HashChip } from "@/components/ui/hash-chip";
import { btnSecondary, label } from "@/components/ui/styles";
import { CompareSlider } from "./compare-slider";

const reveal = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring" as const, stiffness: 220, damping: 26 },
};

/** The report's frame: ink border, ruled header line with a report number. */
function Report({ title, number, children }: { title: string; number?: string; children: React.ReactNode }) {
  return (
    <motion.section {...reveal} className="border border-ink bg-sheet" aria-live="polite">
      <header className={`flex items-center justify-between border-b border-ink px-5 py-2.5 ${label}`}>
        <span>{title}</span>
        {number && <span>N° {number}</span>}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// While the request runs
// ---------------------------------------------------------------------------

/** Lists the procedures the server runs, with a live (real) elapsed-time counter. */
export function ScanningPanel() {
  const elapsed = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      if (elapsed.current) elapsed.current.textContent = `${Math.round(performance.now() - start)} ms`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const checks = [
    "Exact fingerprint (SHA-256) lookup on-chain",
    "Device signature verification (ECDSA P-256)",
    "Perceptual-hash search for a registered original",
    "Pixel comparison and tamper heatmap",
  ];

  return (
    <Report title="Analysing">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-4xl">
          Examining<span className="animate-caret">_</span>
        </p>
        <span ref={elapsed} className="font-mono text-sm tabular-nums text-muted" />
      </div>
      <ol className="mt-5 border-t border-ink">
        {checks.map((c, i) => (
          <motion.li
            key={c}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 * i }}
            className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 border-b border-rule py-3"
          >
            <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
            <span>{c}</span>
            <span className="animate-pulse-dot size-2 bg-signal" />
          </motion.li>
        ))}
      </ol>
    </Report>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Findings({ checks }: { checks: ProofCheck }) {
  const rows: [boolean, string][] = [
    [checks.hashMatchesBytes, "File bytes match the registered SHA-256"],
    [checks.keyMatchesFingerprint, "Public key matches the on-chain fingerprint"],
    [checks.signatureValid, "ECDSA P-256 device signature is valid"],
  ];
  return (
    <ol className="border-t border-ink">
      {rows.map(([ok, text], i) => (
        <motion.li
          key={text}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.45 + i * 0.12 }}
          className="grid grid-cols-[2rem_1.5rem_1fr] items-baseline gap-2 border-b border-rule py-2.5"
        >
          <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span className={`font-display text-xl leading-none ${ok ? "text-authentic" : "text-fake"}`}>{ok ? "✓" : "✕"}</span>
          <span>{text}</span>
        </motion.li>
      ))}
    </ol>
  );
}

function RecordDetails({ record, network }: { record: ChainRecord; network: NetworkInfo }) {
  const explorer = txExplorerUrl(network.chainId, record.txHash);
  return (
    <dl className="mt-5 border-t border-ink">
      <DetailRow label="Block">#{record.blockNumber}</DetailRow>
      <DetailRow label="Sealed">{formatChainTime(record.timestamp)}</DetailRow>
      {record.txHash && (
        <DetailRow label="Tx">
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="text-signal underline">
              <HashChip value={record.txHash} />
            </a>
          ) : (
            <HashChip value={record.txHash} />
          )}
        </DetailRow>
      )}
      <DetailRow label="SHA-256">
        <HashChip value={record.sha256} />
      </DetailRow>
      <DetailRow label="Device key">
        <HashChip value={record.signerKeyHash} />
      </DetailRow>
      {record.parentHash && (
        <DetailRow label="Edit of">
          <HashChip value={record.parentHash} />
        </DetailRow>
      )}
      <DetailRow label="Network">
        {network.name} · {network.chainId}
      </DetailRow>
    </dl>
  );
}

function TimelineLink({ sha256, text }: { sha256: string; text: string }) {
  return (
    <Link href={`/provenance/${sha256}`} className={`${btnSecondary} mt-5 w-full justify-between`}>
      {text} <ArrowRight className="size-4" />
    </Link>
  );
}

function Verdict({ word, tone, sub }: { word: string; tone: string; sub: string }) {
  return (
    <div>
      <p className={label}>Finding</p>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className={`mt-1 font-display text-6xl leading-none sm:text-7xl ${tone}`}
      >
        {word}
      </motion.h2>
      <p className="mt-3 text-muted">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function VerdictPanel({
  result,
  suspectUrl,
  aspect,
}: {
  result: VerifyResponse;
  suspectUrl: string;
  aspect: number;
}) {
  const number = result.sha256.slice(2, 8).toUpperCase();

  if (result.verdict === "AUTHENTIC") {
    return (
      <Report title="Examination report" number={number}>
        <Verdict
          word="Authentic"
          tone="text-authentic"
          sub={`Bit-for-bit identical to a photo sealed on-chain${result.record.parentHash ? " (a registered edit)" : ""}.`}
        />
        <div className="mt-6">
          <Findings checks={result.checks} />
        </div>
        <RecordDetails record={result.record} network={result.network} />
        <TimelineLink sha256={result.record.sha256} text="View provenance timeline" />
      </Report>
    );
  }

  if (result.verdict === "EDITED") {
    // A cropped / mirrored / rotated copy: say how it was reframed, then whether anything else changed.
    const g = result.diff.geometry;
    const reframed = g
      ? [g.cropped && `cropped to ${g.keptPercent}% of the original`, g.mirrored && "mirrored", g.rotation && `rotated ${g.rotation}°`]
          .filter(Boolean)
          .join(", ")
      : null;
    const subtitle = reframed
      ? {
          reencoded: `Same picture, reframed: ${reframed}. Inside that frame no region differs from the original.`,
          adjusted: `Same picture, reframed: ${reframed}, with a whole-image filter. No local region was changed.`,
          modified: `Reframed (${reframed}), and regions differ from the original. The hatched areas show where.`,
        }[result.editKind]
      : {
          reencoded: "Same picture, re-encoded. No region differs from the original. It was recompressed or resized (e.g. sent over WhatsApp), so the file is no longer the signed original.",
          adjusted: "A whole-image filter (brightness/contrast) was applied. No local region was changed.",
          modified: "Regions of this image differ from the registered original. The hatched areas show where.",
        }[result.editKind];
    const pct = result.diff.changedPercent;

    return (
      <Report title="Examination report" number={number}>
        <Verdict word="Edited" tone="text-edited" sub="Derived from a registered original, but not identical to it." />

        {/* Modification meter: a ruler from 0 to 100% */}
        <div className="mt-6 border-t border-ink pt-4">
          <div className="flex items-end justify-between gap-4">
            <p className="font-display text-7xl leading-none tabular-nums">
              <CountUp value={pct} />
              <span className="text-3xl text-muted">%</span>
            </p>
            <p className={`text-right ${label}`}>
              of image
              <br />
              modified
            </p>
          </div>
          <div className="relative mt-4 h-4 border border-ink">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px 10%)" }}
            />
            <motion.div
              className="hatch absolute inset-y-0 left-0 bg-edited/20 text-edited"
              initial={{ width: 0 }}
              // Floor of 1.5% so even a tiny change is visible on the ruler.
              animate={{ width: `${pct === 0 ? 0 : Math.max(1.5, Math.min(100, pct))}%` }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className={`mt-1 flex justify-between ${label} text-[9px]`}>
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
          <p className="mt-4">{subtitle}</p>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
            <span className="border border-rule px-2 py-1 text-muted">{result.diff.changedCells}/256 regions changed</span>
            {result.diff.globalAdjustment && <span className="border border-edited px-2 py-1 text-edited">global filter detected</span>}
            {result.diff.geometry?.cropped && (
              <span className="border border-edited px-2 py-1 text-edited">cropped · kept {result.diff.geometry.keptPercent}% of the original</span>
            )}
            {result.diff.geometry?.mirrored && <span className="border border-edited px-2 py-1 text-edited">mirrored</span>}
            {!!result.diff.geometry?.rotation && (
              <span className="border border-edited px-2 py-1 text-edited">rotated {result.diff.geometry.rotation}°</span>
            )}
            {!result.diff.geometry && result.diff.alignment === "approximate" && (
              <span className="border border-edited px-2 py-1 text-edited">reframed / cropped: approximate</span>
            )}
          </div>
        </div>

        <div className="mt-6">
          <p className={`mb-2 ${label}`}>Compare with the original</p>
          <CompareSlider original={result.originalUrl} suspect={suspectUrl} aspect={aspect} geometry={result.diff.geometry} />
        </div>

        <div className="mt-6">
          <p className={`mb-2 ${label}`}>The original is genuine</p>
          <Findings checks={result.originalChecks} />
        </div>
        <dl className="mt-2">
          <DetailRow label="Similarity">
            {result.similarity}% · {result.distance}/64 bits differ
          </DetailRow>
        </dl>
        <RecordDetails record={result.original} network={result.network} />
        <TimelineLink sha256={result.original.sha256} text="The original's provenance timeline" />
      </Report>
    );
  }

  // UNVERIFIED
  const reasonCopy = {
    NO_RECORD: "No provenance record matches this image, exactly or visually.",
    SIGNATURE_INVALID: "A record exists for these exact bytes, but its signature proof failed. The stored proof may have been tampered with.",
    PROOF_MISSING: "A record exists for these exact bytes, but its signature proof could not be loaded, so authenticity cannot be confirmed.",
    NOT_A_DERIVATIVE: "A registered photo looked similar, but the pixels differ too much for this to be an edit of it.",
  }[result.reason];

  return (
    <Report title="Examination report" number={number}>
      <Verdict word="Unverified" tone="text-fake" sub="No trustworthy provenance found." />
      <p className="mt-5 border-t border-ink pt-4">{reasonCopy}</p>

      <aside className="mt-4 border-l-[3px] border-ink bg-paper p-4">
        <p className="font-display text-xl">Note —</p>
        <p className="mt-1 text-muted">
          This does <strong className="text-ink">not</strong> prove the image is fake. It may come from another
          camera, be AI-generated, or be edited beyond recognition. TruthLens proves where a photo came from; it does
          not run AI deepfake detection.
        </p>
      </aside>

      <dl className="mt-5 border-t border-ink">
        <DetailRow label="SHA-256">
          <HashChip value={result.sha256} />
        </DetailRow>
        {result.pHash && (
          <DetailRow label="pHash">
            <HashChip value={result.pHash} />
          </DetailRow>
        )}
        {result.nearestDistance !== null && result.reason === "NO_RECORD" && (
          <DetailRow label="Closest record">
            {result.nearestDistance}/64 bits differ (match needs ≤ {PHASH_MATCH_THRESHOLD})
          </DetailRow>
        )}
        <DetailRow label="Network">
          {result.network.name} · {result.network.chainId}
        </DetailRow>
      </dl>
    </Report>
  );
}
