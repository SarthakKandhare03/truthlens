"use client";

// The sealing sequence, printed as an evidence receipt:
//   Hashing → Signing → Writing to blockchain → Sealed
// Each line shows the REAL value it produced (hash, signature, tx) and the
// REAL time it took; the animation only enforces a minimum display time.
// When sealed, the receipt prints a barcode generated from the photo's hash.
import { AnimatePresence, motion } from "framer-motion";
import { ScrambleText } from "@/components/ui/scramble-text";

export type StepStatus = "pending" | "active" | "done" | "error";
export type Step = {
  id: "hash" | "sign" | "chain" | "sealed";
  title: string;
  subtitle: string;
  status: StepStatus;
  ms?: number;
  lines?: { label: string; value: string }[];
};

function StatusMark({ status }: { status: StepStatus }) {
  if (status === "done") return <span className="text-authentic">✓</span>;
  if (status === "error") return <span className="text-fake">✕</span>;
  if (status === "active")
    return (
      <motion.span
        className="inline-block size-2.5 border border-signal"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
      />
    );
  return <span className="text-muted">○</span>;
}

/**
 * A decorative barcode derived from a hex hash: every hex digit sets the width
 * of one bar and the gap after it, so each photo's receipt is unique.
 */
function HashBarcode({ hash }: { hash: string }) {
  const digits = hash.replace(/^0x/, "").slice(0, 48);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const d of digits) {
    const n = parseInt(d, 16);
    const w = 1 + (n % 3);
    bars.push({ x, w });
    x += w + 1 + ((n >> 2) % 3);
  }
  return (
    <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="currentColor" />
      ))}
    </svg>
  );
}

export function SealSequence({ steps, footer, barcode }: { steps: Step[]; footer?: React.ReactNode; barcode?: string | null }) {
  const sealed = steps.every((s) => s.status === "done");
  const failed = steps.some((s) => s.status === "error");
  const header = sealed
    ? { title: "Provenance sealed", badge: "on-chain", tone: "text-authentic" }
    : failed
      ? { title: "Sealing failed", badge: "stopped", tone: "text-fake" }
      : { title: "Sealing photo", badge: "working", tone: "text-signal" };

  return (
    <motion.section
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 26 }}
      className="pointer-events-auto absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[420px]"
      aria-live="polite"
    >
      <div className="perforated bg-sheet pt-4 text-ink shadow-[0_24px_48px_rgb(0_0_0/0.45)]">
        <div className="px-5 pb-[max(env(safe-area-inset-bottom),20px)] font-mono text-[12px]">
          {/* Receipt header */}
          <div className="border-b border-dashed border-ink/40 pb-3 text-center">
            <p className="font-display text-2xl normal-case leading-none tracking-tight">
              Truth<em className="text-signal">Lens</em>
            </p>
            <p className="mt-1 uppercase tracking-[0.3em] text-muted">Receipt of seal</p>
          </div>
          <div className="flex items-center justify-between border-b border-dashed border-ink/40 py-2 uppercase tracking-[0.2em]">
            <span>{header.title}</span>
            <span className={`flex items-center gap-1.5 ${header.tone}`}>
              <span className={`size-1.5 bg-current ${!sealed && !failed ? "animate-pulse-dot" : ""}`} />
              {header.badge}
            </span>
          </div>

          {/* Line items */}
          <ol className="py-2">
            {steps.map((step) => (
              <li key={step.id} className="py-2">
                <div className={`flex items-baseline gap-2 ${step.status === "pending" ? "text-muted" : ""}`}>
                  <span className="w-3 text-center">
                    <StatusMark status={step.status} />
                  </span>
                  <span className={`uppercase tracking-[0.14em] ${step.status === "error" ? "text-fake" : ""}`}>{step.title}</span>
                  {/* dotted leader, like a receipt line */}
                  <span aria-hidden className="mb-1 flex-1 border-b border-dotted border-ink/40" />
                  <span className="tabular-nums text-muted">{step.ms !== undefined ? `${step.ms} ms` : "—"}</span>
                </div>
                <p className="ml-5 font-sans text-[11px] text-muted">{step.subtitle}</p>
                <AnimatePresence>
                  {step.lines?.map((line) => (
                    <motion.p
                      key={line.label}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="ml-5 flex gap-2 overflow-hidden text-[11px] leading-5"
                    >
                      <span className="shrink-0 text-muted">{line.label}</span>
                      <ScrambleText text={line.value} className="truncate text-signal" />
                    </motion.p>
                  ))}
                </AnimatePresence>
              </li>
            ))}
          </ol>

          {/* Barcode from the photo's hash */}
          <AnimatePresence>
            {sealed && barcode && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="overflow-hidden border-t border-dashed border-ink/40 pt-3 text-ink"
              >
                <HashBarcode hash={barcode} />
                <p className="mt-1 text-center text-[10px] tracking-[0.3em] text-muted">{barcode.slice(0, 18)}…</p>
              </motion.div>
            )}
          </AnimatePresence>

          {footer && <div className="mt-4 border-t border-dashed border-ink/40 pt-4 font-sans text-sm">{footer}</div>}
        </div>
      </div>
    </motion.section>
  );
}
