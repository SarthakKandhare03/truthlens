"use client";

// Verify page, two modes:
//   Upload a file   drop an image → scan animation → verdict (bit-for-bit)
//   Live camera     point the camera at a photo → its sealed original, in
//                   real time (see live-verify.tsx)
//
// The scan animation runs at least MIN_SCAN_MS so the reveal has a beat of
// suspense. The server's answer usually arrives sooner; the elapsed counter in
// the panel shows the real time spent.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Camera, Eye, EyeOff, FileImage, RefreshCcw, TriangleAlert } from "lucide-react";
import type { VerifyResponse } from "@/lib/api-types";
import { ApiError, verifyPhoto } from "@/lib/client/api";
import { atLeast, describeError } from "@/lib/client/format";
import { takeHandOff } from "@/lib/client/handoff";
import { DropZone, VerdictLegend } from "./drop-zone";
import { LiveVerify } from "./live-verify";
import { PixelStage } from "./pixel-stage";
import { ScanningPanel, VerdictPanel } from "./verdict-panel";
import { primaryAction, StateCard } from "@/components/ui/state-card";
import type { StampTone } from "@/components/ui/stamp";
import { label } from "@/components/ui/styles";

const MAX_BYTES = 15 * 1024 * 1024;
const MIN_SCAN_MS = 2200;

type State =
  | { kind: "idle" }
  | { kind: "scanning"; url: string; aspect: number; name: string; size: number }
  | { kind: "result"; url: string; aspect: number; name: string; size: number; result: VerifyResponse }
  | { kind: "error"; message: string; url?: string; aspect?: number };

/** Loads an image just to learn its natural aspect ratio. */
function measure(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
    img.onerror = () =>
      reject(
        new Error(
          "This browser can't display that image. iPhone HEIC photos are a common cause: export it as JPEG (or set the camera to \"Most Compatible\") and try again.",
        ),
      );
    img.src = url;
  });
}

export function VerifyView() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [showHeat, setShowHeat] = useState(true);
  const [mode, setMode] = useState<"file" | "live">("file");

  // Free the previous object URL whenever the image changes.
  const currentUrl = "url" in state ? state.url : undefined;
  useEffect(() => () => void (currentUrl && URL.revokeObjectURL(currentUrl)), [currentUrl]);

  const verify = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setState({ kind: "error", message: "That file isn't an image." });
        return;
      }
      if (file.size > MAX_BYTES) {
        setState({ kind: "error", message: "That image is too large (max 15 MB)." });
        return;
      }

      const url = URL.createObjectURL(file);
      let aspect = 4 / 3;
      try {
        aspect = await measure(url);
      } catch (err) {
        setState({ kind: "error", message: (err as Error).message });
        return;
      }

      setShowHeat(true);
      setMode("file");
      setState({ kind: "scanning", url, aspect, name: file.name, size: file.size });
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });

      try {
        const { value } = await atLeast(reduce ? 300 : MIN_SCAN_MS, () => verifyPhoto(file));
        setState({ kind: "result", url, aspect, name: file.name, size: file.size, result: value });
      } catch (err) {
        const message = err instanceof ApiError ? describeError(err.code, err.message) : (err as Error).message;
        setState({ kind: "error", message, url, aspect });
      }
    },
    [reduce],
  );

  // Arriving from the Capture page with a freshly sealed photo? Verify it right away.
  // The ref matters: in development React runs effects twice (mount, unmount,
  // mount). takeHandOff() empties the hand-off, so the file is parked in the ref
  // where the second run still finds it. The timeout is cancelled by the first
  // cleanup, so verification starts exactly once.
  const handed = useRef<File | null>(null);
  useEffect(() => {
    handed.current ??= takeHandOff();
    const file = handed.current;
    if (!file) return;
    const t = setTimeout(() => {
      handed.current = null;
      void verify(file);
    }, 0);
    return () => clearTimeout(t);
  }, [verify]);

  const reset = () => setState({ kind: "idle" });
  const verdict = state.kind === "result" ? state.result.verdict : null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
        <div className={`flex justify-between border-b border-ink pb-3 ${label}`}>
          <span>§ Verify — Examination</span>
          <span className="hidden sm:inline">Reads the ledger · no account needed</span>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl lg:col-span-8">
            Where did this photo <em className="text-signal">come from?</em>
          </h1>
          <p className="self-end text-muted lg:col-span-4">
            Drop any image. TruthLens checks it against signed, on-chain capture records: the original, an edited copy,
            or no provenance at all.
          </p>
        </div>
      </motion.header>

      {state.kind === "idle" && (
        <div role="tablist" aria-label="How to verify" className="mb-6 flex gap-2">
          {(
            [
              ["file", "Upload a file", <FileImage key="f" className="size-4" />],
              ["live", "Live camera", <Camera key="c" className="size-4" />],
            ] as const
          ).map(([m, text, icon]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-2 border-2 px-4 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal ${
                mode === m ? "border-ink bg-ink text-paper" : "border-rule text-muted hover:border-ink hover:text-ink"
              }`}
            >
              {icon} {text}
              {m === "live" && <span className="bg-alarm px-1.5 py-0.5 text-[9px] text-white">new</span>}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {state.kind === "idle" && mode === "file" && (
          <motion.div key="idle" exit={{ opacity: 0, y: -10 }} className="space-y-8">
            <DropZone onFile={verify} />
            <VerdictLegend />
          </motion.div>
        )}
        {state.kind === "idle" && mode === "live" && (
          <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LiveVerify />
          </motion.div>
        )}

        {state.kind === "error" && !state.url && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ErrorCard message={state.message} onRetry={reset} />
          </motion.div>
        )}

        {"url" in state && state.url && (
          <motion.div
            key="stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
          >
            <div className="space-y-3 lg:sticky lg:top-24">
              <p className={label}>Exhibit A</p>
              <PixelStage
                src={state.url}
                aspect={state.aspect ?? 4 / 3}
                scanning={state.kind === "scanning"}
                verdict={verdict}
                heat={state.kind === "result" && state.result.verdict === "EDITED" ? state.result.diff.grid : undefined}
                showHeat={showHeat}
                stamp={state.kind === "result" ? stampFor(state.result) : null}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate font-mono text-xs text-muted">
                  {"name" in state && `${state.name} · ${(state.size / 1024 / 1024).toFixed(2)} MB`}
                </p>
                <div className="flex gap-2">
                  {verdict === "EDITED" && (
                    <button
                      onClick={() => setShowHeat((s) => !s)}
                      className="flex items-center gap-1.5 border border-edited px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-edited outline-none hover:bg-edited hover:text-paper focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      {showHeat ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showHeat ? "Hide heatmap" : "Show heatmap"}
                    </button>
                  )}
                  {state.kind !== "scanning" && (
                    <button
                      onClick={reset}
                      className="flex items-center gap-1.5 border border-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] outline-none hover:bg-ink hover:text-paper focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      <RefreshCcw className="size-3.5" /> Verify another
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <AnimatePresence mode="wait">
                {state.kind === "scanning" && (
                  <motion.div key="scan" exit={{ opacity: 0, y: -8 }}>
                    <ScanningPanel />
                  </motion.div>
                )}
                {state.kind === "result" && (
                  <motion.div key="verdict">
                    <VerdictPanel result={state.result} suspectUrl={state.url} aspect={state.aspect} />
                  </motion.div>
                )}
                {state.kind === "error" && (
                  <motion.div key="err">
                    <ErrorCard message={state.message} onRetry={reset} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateCard
      icon={<TriangleAlert />}
      tone="danger"
      eyebrow="Examination failed"
      title="Verification couldn't run."
      actions={
        <button onClick={onRetry} className={primaryAction}>
          Try another image
        </button>
      }
    >
      {message}
    </StateCard>
  );
}

/** The rubber stamp that lands on the exhibit for each verdict. */
function stampFor(result: VerifyResponse): { label: string; sub?: string; tone: StampTone } {
  if (result.verdict === "AUTHENTIC") return { label: "Authentic", sub: `block #${result.record.blockNumber}`, tone: "authentic" };
  if (result.verdict === "EDITED") return { label: "Edited", sub: `${result.diff.changedPercent}% modified`, tone: "edited" };
  return { label: "Unverified", sub: "no record", tone: "fake" };
}
