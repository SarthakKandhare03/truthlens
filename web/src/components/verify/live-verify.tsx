"use client";

// Live verify: point the camera at a photo (on a phone, a screen or paper)
// and TruthLens looks for its sealed original on the ledger, in real time.
//
//   every ~250 ms   hash the guide area at 270 crops in the browser
//                   (lib/client/frame-hash.ts) → POST the hashes to /api/match
//   every frame     add the result to a sliding window; decide() locks a match
//                   only when one sealed photo wins 3 of the last 6 frames
//
// What it proves: that a sealed photo LOOKS like what the camera sees, and
// that photo's on-chain record (when, which device). It cannot prove the copy
// is bit-for-bit identical, since a re-capture has new bytes. Uploading the
// file gives that full verdict. Only one request is in flight at a time, so a
// slow network lowers the frame rate instead of piling up requests.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Pause, Play, RectangleHorizontal, RectangleVertical, SwitchCamera, TriangleAlert } from "lucide-react";
import type { ChainRecord } from "@/lib/api-types";
import { matchFrame } from "@/lib/client/api";
import { formatChainTime, shortHash } from "@/lib/client/format";
import { FrameHasher, guideBox, type Shape } from "@/lib/client/frame-hash";
import { useCamera } from "@/lib/client/use-camera";
import { decide, likeness, LIVE_MATCH, pushFrame, type FrameResult, type LiveState } from "@/lib/live-match";
import { Stamp } from "@/components/ui/stamp";
import { btnPrimary, btnSecondary, label } from "@/components/ui/styles";

const FRAME_EVERY_MS = 250;
const TOO_DARK = 35;
const TOO_FLAT = 10;

type Light = "ok" | "dark" | "flat";

export function LiveVerify() {
  const { videoRef, status, facing, canSwitch, resolution, errorText, switchCamera, retry } = useCamera();
  const [shape, setShape] = useState<Shape>("landscape");
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState<LiveState>({ kind: "warming" });
  const [light, setLight] = useState<Light>("ok");
  const [ms, setMs] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [record, setRecord] = useState<ChainRecord | null>(null);
  const records = useRef(new Map<string, ChainRecord>());
  const history = useRef<FrameResult[]>([]);

  // Changing the framing (or pausing) starts a fresh window.
  const restart = () => {
    history.current = [];
    setLive({ kind: "warming" });
    setRecord(null);
  };

  useEffect(() => {
    if (status !== "live" || paused) return;
    const hasher = new FrameHasher();
    const abort = new AbortController();
    let stopped = false;
    let timer = 0;

    const tick = async () => {
      const video = videoRef.current;
      const started = performance.now();
      const frame = video ? hasher.hash(video, shape) : null;
      if (frame) {
        const lighting: Light = frame.mean < TOO_DARK ? "dark" : frame.contrast < TOO_FLAT ? "flat" : "ok";
        setLight(lighting);
        try {
          // A dark or empty frame is not evidence of anything: skip it.
          const res = lighting === "ok" ? await matchFrame(frame.hashes, abort.signal) : null;
          if (stopped) return;
          setOffline(false);
          if (res) {
            if (res.record) records.current.set(res.record.sha256, res.record);
            const result: FrameResult = res.best && res.best.distance <= LIVE_MATCH ? res.best : null;
            history.current = pushFrame(history.current, result);
            const decision = decide(history.current);
            setLive(decision);
            setRecord(decision.kind === "match" ? (records.current.get(decision.sha256) ?? null) : null);
          }
          setMs(Math.round(performance.now() - started));
        } catch {
          if (stopped) return;
          setOffline(true);
        }
      }
      if (!stopped) timer = window.setTimeout(tick, Math.max(0, FRAME_EVERY_MS - (performance.now() - started)));
    };
    timer = window.setTimeout(tick, FRAME_EVERY_MS);
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [status, videoRef, paused, shape]);

  const res = resolution ?? { width: 16, height: 9 };
  const box = guideBox(shape, res.width, res.height);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const match = live.kind === "match" ? live : null;
  const tone = match ? "authentic" : live.kind === "none" ? "fake" : "ink";
  const frameColor = { authentic: "border-authentic", edited: "border-edited", fake: "border-fake", ink: "border-white/80" }[tone];

  if (status !== "live" && status !== "starting") return <CameraProblem status={status} detail={errorText} onRetry={retry} />;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <p className={label}>Live view</p>
        <div
          className="relative overflow-hidden border-2 border-ink bg-black"
          style={{ aspectRatio: `${res.width} / ${res.height}` }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            className={`size-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
            aria-label="Camera view"
          />
          {/* Darken everything outside the guide */}
          <div
            aria-hidden
            className={`pointer-events-none absolute border-2 transition-colors duration-300 ${frameColor}`}
            style={{
              left: pct(box.x, res.width),
              top: pct(box.y, res.height),
              width: pct(box.w, res.width),
              height: pct(box.h, res.height),
              boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
            }}
          >
            {live.kind !== "match" && !paused && (
              <motion.div
                className="absolute inset-x-0 h-0.5 bg-signal/80"
                animate={{ top: ["0%", "100%", "0%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <span className="absolute -top-6 left-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/90">
              Fit the whole photo inside
            </span>
          </div>
          <AnimatePresence>
            {match && (
              <motion.div key={match.sha256} className="pointer-events-none absolute inset-0 grid place-items-center" exit={{ opacity: 0 }}>
                <Stamp
                  label="Sealed"
                  sub={record ? `block #${record.blockNumber}` : "on-chain"}
                  tone="authentic"
                  size="lg"
                  slam
                  className="bg-black/55"
                />
              </motion.div>
            )}
          </AnimatePresence>
          {status === "starting" && (
            <p className="absolute inset-0 grid place-items-center font-mono text-xs uppercase tracking-[0.2em] text-white/80">
              Starting camera…
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToolButton
            onClick={() => {
              setShape((s) => (s === "landscape" ? "portrait" : "landscape"));
              restart();
            }}
            icon={shape === "landscape" ? <RectangleVertical className="size-3.5" /> : <RectangleHorizontal className="size-3.5" />}
            text={shape === "landscape" ? "Portrait photo" : "Landscape photo"}
          />
          <ToolButton
            onClick={() => {
              setPaused((p) => !p);
              restart();
            }}
            icon={paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            text={paused ? "Resume" : "Pause"}
          />
          {canSwitch && (
            <ToolButton
              onClick={() => {
                switchCamera();
                restart();
              }}
              icon={<SwitchCamera className="size-3.5" />}
              text="Switch camera"
            />
          )}
          <span className="ml-auto font-mono text-[11px] text-muted">
            {paused ? "paused" : ms !== null ? `${ms} ms / frame · 270 crops · hashes only` : "warming up"}
          </span>
        </div>
      </div>

      <LivePanel live={live} record={record} light={light} offline={offline} paused={paused} />
    </div>
  );
}

function ToolButton({ onClick, icon, text }: { onClick: () => void; icon: React.ReactNode; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 border border-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] outline-none hover:bg-ink hover:text-paper focus-visible:ring-2 focus-visible:ring-signal"
    >
      {icon} {text}
    </button>
  );
}

/** The report beside the camera: what the live view currently sees. */
function LivePanel({
  live,
  record,
  light,
  offline,
  paused,
}: {
  live: LiveState;
  record: ChainRecord | null;
  light: Light;
  offline: boolean;
  paused: boolean;
}) {
  const hint = offline
    ? "Can't reach the TruthLens server."
    : light === "dark"
      ? "Too dark: add some light."
      : light === "flat"
        ? "Nothing in view: point the camera at a photo."
        : null;

  return (
    <section className="border border-ink bg-sheet" aria-live="polite">
      <header className={`flex justify-between border-b border-ink px-5 py-2.5 ${label}`}>
        <span>Live examination</span>
        <span className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${paused ? "bg-muted" : "animate-pulse-dot bg-alarm"}`} /> {paused ? "Paused" : "Live"}
        </span>
      </header>
      <div className="p-5 sm:p-6">
        {live.kind === "match" ? (
          <MatchReport live={live} record={record} />
        ) : live.kind === "none" ? (
          <>
            <p className={label}>Finding</p>
            <h2 className="mt-2 font-display text-5xl leading-none text-fake">No sealed original</h2>
            <p className="mt-3 text-muted">
              Nothing on the ledger looks like this. Its origin can&apos;t be proven, which is not the same as proven
              fake. Keep the whole photo inside the frame for a few seconds to be sure.
            </p>
          </>
        ) : (
          <>
            <p className={label}>Finding</p>
            <h2 className="mt-2 font-display text-5xl leading-none">Scanning…</h2>
            <p className="mt-3 text-muted">
              Hold the camera over a photo on a screen or on paper, with the whole photo inside the frame. TruthLens
              compares what it sees with every sealed photo on the ledger.
            </p>
          </>
        )}

        {hint && (
          <p className="mt-5 flex items-center gap-2 border border-edited px-3 py-2 text-sm text-edited">
            <TriangleAlert className="size-4 shrink-0" /> {hint}
          </p>
        )}

        <p className="mt-6 border-t border-rule pt-4 text-xs leading-5 text-muted">
          Live mode matches what a photo <b>looks like</b>, so it can find the sealed original of a photo shown on
          a screen or printed. A re-photographed image always has new bytes, so it can never be AUTHENTIC by
          itself: for the bit-for-bit verdict, upload the actual file.
        </p>
      </div>
    </section>
  );
}

function MatchReport({ live, record }: { live: Extract<LiveState, { kind: "match" }>; record: ChainRecord | null }) {
  return (
    <>
      <p className={label}>Finding</p>
      <h2 className="mt-2 font-display text-5xl leading-none text-authentic">Sealed original found</h2>
      <p className="mt-3 text-muted">
        What the camera sees matches a photo sealed on the ledger
        {live.close ? ", almost exactly." : "."} Re-photographing always adds a few bits of difference (glare,
        tilt, blur), so a camera can&apos;t rule out a small edit: compare it with the original below, or upload the
        file for the bit-for-bit verdict.
      </p>

      <div className="mt-5 flex items-end justify-between border-y border-ink py-3">
        <div>
          <p className={label}>Likeness</p>
          <p className="font-display text-5xl leading-none tabular-nums">{likeness(live.distance)}%</p>
        </div>
        <p className="text-right font-mono text-[11px] text-muted">
          {live.distance}/64 bits differ
          <br />
          locked on {live.hits} of the last 6 frames
        </p>
      </div>

      {record && (
        <div className="mt-5 grid grid-cols-[96px_minmax(0,1fr)] gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- content-addressed thumbnail from our own API */}
          <img src={`/api/images/${record.sha256}?w=160`} alt="The sealed original" className="aspect-square w-24 border border-ink object-cover" />
          <dl className="space-y-1 font-mono text-[12px]">
            <div><dt className="inline text-muted">Block </dt><dd className="inline">#{record.blockNumber}</dd></div>
            <div><dt className="inline text-muted">Sealed </dt><dd className="inline" suppressHydrationWarning>{formatChainTime(record.timestamp)}</dd></div>
            <div><dt className="inline text-muted">SHA-256 </dt><dd className="inline">{shortHash(record.sha256)}</dd></div>
            <div><dt className="inline text-muted">Device </dt><dd className="inline">{shortHash(record.signerKeyHash)}</dd></div>
          </dl>
        </div>
      )}
      {record && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/provenance/${record.sha256}`} className={btnPrimary} data-cursor="Open">
            Provenance <ArrowRight className="size-4" />
          </Link>
          <a href={`/api/images/${record.sha256}`} target="_blank" rel="noreferrer" className={btnSecondary}>
            Full original
          </a>
        </div>
      )}
    </>
  );
}

function CameraProblem({ status, detail, onRetry }: { status: string; detail: string | null; onRetry: () => void }) {
  const copy: Record<string, { title: string; body: string }> = {
    insecure: {
      title: "Camera needs a secure connection",
      body: "Browsers only allow the camera on https:// or localhost. On a phone, run `npm run dev:https` and open the https:// address.",
    },
    denied: { title: "Camera permission blocked", body: "Allow camera access for this site in your browser settings, then retry." },
    unavailable: { title: "No camera found", body: "This device doesn't seem to have a camera. Upload the image file instead." },
    error: { title: "Camera failed to start", body: detail ?? "Something went wrong opening the camera." },
  };
  const { title, body } = copy[status] ?? copy.error;
  return (
    <div role="alert" className="mx-auto w-full max-w-lg border border-ink bg-sheet">
      <div className={`flex items-center justify-between border-b border-ink px-5 py-2.5 ${label} text-edited`}>
        <span>Live camera</span>
        <TriangleAlert className="size-4" />
      </div>
      <div className="p-5">
        <h2 className="font-display text-3xl leading-tight">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        {status !== "insecure" && status !== "unavailable" && (
          <button onClick={onRetry} className={`mt-5 ${btnPrimary}`}>
            Retry camera
          </button>
        )}
      </div>
    </div>
  );
}
