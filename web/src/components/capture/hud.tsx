"use client";

// Sci-fi heads-up display drawn over the camera viewfinder.
//
// Everything here is decoration EXCEPT the status light, which tells the truth:
// "SECURE" only lights up once this device's signing key is loaded, i.e. once a
// photo taken now can actually be signed.
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { shortHash } from "@/lib/client/format";

export type KeyState = "loading" | "ready" | "error";

type Props = {
  keyState: KeyState;
  keyFingerprint: string | null;
  resolution: { width: number; height: number } | null;
  dimmed: boolean; // while sealing, the HUD steps back
};

/** Live clock with milliseconds. Written straight to the DOM every frame, so React does not re-render 60×/s. */
function LiveTimestamp() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const offsetMin = -new Date().getTimezoneOffset();
    const tz = `UTC${offsetMin >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
    const tick = () => {
      const d = new Date();
      if (ref.current) {
        ref.current.textContent =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${tz}`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <span ref={ref} className="tabular-nums" />;
}

function Bracket({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute size-10 border-white sm:size-14 ${className}`}
    />
  );
}

export function Hud({ keyState, keyFingerprint, resolution, dimmed }: Props) {
  const status = {
    // Fixed bright colours: the HUD sits on live video, whatever the site theme.
    loading: { text: "ARMING KEY", dot: "bg-[#eaa53a]", label: "text-[#eaa53a]" },
    ready: { text: "SECURE", dot: "bg-[#4cc58b]", label: "text-white" },
    error: { text: "NO KEY", dot: "bg-[#ff5d4d]", label: "text-[#ff5d4d]" },
  }[keyState];

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 font-mono text-[11px] uppercase tracking-[0.2em] text-white/80 sm:text-xs"
      animate={{ opacity: dimmed ? 0.35 : 1 }}
      style={{
        padding:
          "max(env(safe-area-inset-top), 16px) max(env(safe-area-inset-right), 16px) max(env(safe-area-inset-bottom), 16px) max(env(safe-area-inset-left), 16px)",
      }}
    >
      <div className="relative size-full">
        {/* Corner brackets */}
        <Bracket className="left-0 top-0 border-l-2 border-t-2" />
        <Bracket className="right-0 top-0 border-r-2 border-t-2" />
        <Bracket className="bottom-28 left-0 border-b-2 border-l-2 sm:bottom-32" />
        <Bracket className="bottom-28 right-0 border-b-2 border-r-2 sm:bottom-32" />

        {/* Top row: status light + clock */}
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
          <div className="flex items-center gap-2 bg-black/55 px-2 py-1">
            <span className={`size-2 ${status.dot} ${keyState === "ready" ? "animate-pulse-dot" : ""}`} />
            <span className={status.label}>{status.text}</span>
          </div>
          <div className="bg-black/55 px-2 py-1">
            <LiveTimestamp />
          </div>
        </div>

        {/* Rule-of-thirds grid */}
        <div aria-hidden className="absolute inset-x-0 bottom-28 top-0 opacity-25 sm:bottom-32">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
        </div>

        {/* Centre reticle (hidden while sealing: the frame is already taken) */}
        <div
          aria-hidden
          className={`absolute left-1/2 top-[calc(50%-3.5rem)] -translate-x-1/2 -translate-y-1/2 transition-opacity sm:top-[calc(50%-4rem)] ${dimmed ? "opacity-0" : ""}`}
        >
          <div className="relative size-16 rounded-full border border-white/70">
            <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 bg-white" />
            <span className="absolute -left-3 top-1/2 h-px w-4 bg-white/80" />
            <span className="absolute -right-3 top-1/2 h-px w-4 bg-white/80" />
            <span className="absolute -top-3 left-1/2 h-4 w-px bg-white/80" />
            <span className="absolute -bottom-3 left-1/2 h-4 w-px bg-white/80" />
          </div>
        </div>

        {/* Slow scan sweep */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-24 animate-hud-sweep bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        {/* Bottom info row, above the controls. Hidden while sealing, where the
            sealing panel takes this space and would otherwise sit behind the receipt. */}
        <div
          className={`absolute inset-x-3 bottom-[7.5rem] flex flex-wrap items-end justify-between gap-2 transition-opacity sm:inset-x-5 sm:bottom-[8.5rem] ${dimmed ? "opacity-0" : ""}`}
        >
          <div className="bg-black/55 px-2 py-1">
            <span className="text-white/50">KEY </span>
            {keyFingerprint ? shortHash(keyFingerprint) : "…"}
            <span className="text-white/50"> · P-256</span>
          </div>
          {resolution && (
            <div className="bg-black/55 px-2 py-1">
              {resolution.width}×{resolution.height} <span className="text-white/50">· SHA-256</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
