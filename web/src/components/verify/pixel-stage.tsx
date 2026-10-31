"use client";

// The image "stage" on the Verify page: the exhibit under examination.
//
// The picture is cut into a 16×16 grid of tiles (each tile shows its slice of
// the image via background-position). That grid deliberately matches the
// server's 16×16 tamper heatmap, so in the EDITED verdict each tile shows
// exactly the share of its region that changed.
//
//   scanning    tiles separate into a ruled grid, an accent-coloured scan line sweeps over
//   AUTHENTIC   tiles snap back together, a green wave ripples outwards, stamp
//   EDITED      changed regions are cross-hatched (ochre → red by how much
//               changed), untouched regions fade back, stamp in the corner
//   UNVERIFIED  corrupted-signal glitch bands + stamp
//   loupe       once a verdict is in, hovering the exhibit shows a circular
//               magnifier (×2.5) over the raw image, like a forensic loupe
//
// Performance: only transform and opacity are animated (GPU-friendly), so 256
// tiles stay smooth. Reduced motion: MotionConfig turns the motion off and the
// CSS glitch is disabled by the media query in globals.css.
import { useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Stamp, type StampTone } from "@/components/ui/stamp";

export type StageVerdict = "AUTHENTIC" | "EDITED" | "UNVERIFIED";

type Props = {
  src: string;
  aspect: number; // width / height
  scanning: boolean;
  verdict: StageVerdict | null;
  heat?: number[]; // gridSize² values 0–1 (EDITED only)
  showHeat?: boolean;
  stamp?: { label: string; sub?: string; tone: StampTone } | null;
  gridSize?: number;
};

/** Loupe magnification and diameter (px). */
const ZOOM = 2.5;
const LOUPE = 170;

/** A tile counts as "changed" in the heatmap when at least 5% of its pixels changed. */
const HOT_TILE = 0.05;

const FRAME: Record<StageVerdict, string> = {
  AUTHENTIC: "border-authentic",
  EDITED: "border-edited",
  UNVERIFIED: "border-fake",
};

export function PixelStage({ src, aspect, scanning, verdict, heat, showHeat = true, stamp, gridSize = 16 }: Props) {
  const tiles = useMemo(() => {
    const centre = (gridSize - 1) / 2;
    return Array.from({ length: gridSize * gridSize }, (_, i) => {
      const r = Math.floor(i / gridSize);
      const c = i % gridSize;
      return { i, r, c, dist: Math.hypot(r - centre, c - centre) };
    });
  }, [gridSize]);

  const split = scanning;
  const pct = (n: number) => `${(n / gridSize) * 100}%`;
  const stage = useRef<HTMLDivElement>(null);
  const loupe = useRef<HTMLDivElement>(null);
  const canLoupe = !scanning && verdict !== null;

  // The loupe follows the mouse by writing styles directly (no re-render per move).
  const moveLoupe = (e: React.PointerEvent) => {
    const el = loupe.current;
    const box = stage.current?.getBoundingClientRect();
    if (!canLoupe || !el || !box || e.pointerType !== "mouse") return;
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    el.style.opacity = "1";
    el.style.transform = `translate(${px - LOUPE / 2}px, ${py - LOUPE / 2}px)`;
    el.style.backgroundSize = `${box.width * ZOOM}px ${box.height * ZOOM}px`;
    el.style.backgroundPosition = `${-(px * ZOOM - LOUPE / 2)}px ${-(py * ZOOM - LOUPE / 2)}px`;
  };
  const hideLoupe = () => {
    if (loupe.current) loupe.current.style.opacity = "0";
  };

  return (
    <div
      ref={stage}
      onPointerMove={moveLoupe}
      onPointerLeave={hideLoupe}
      data-cursor={canLoupe ? "hide" : undefined}
      className={`relative mx-auto overflow-hidden border-2 bg-paper transition-colors duration-500 ${verdict && !scanning ? FRAME[verdict] : "border-ink"}`}
      // Keep the image's own aspect ratio, but never taller than ~62% of the screen.
      style={{ aspectRatio: aspect, width: `min(100%, calc(62vh * ${aspect}))` }}
    >
      {/* Full image underneath the tiles */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob: URL, next/image cannot optimise it */}
      <img
        src={src}
        alt="Image being verified"
        className="absolute inset-0 size-full object-cover transition-opacity duration-500"
        style={{ opacity: split ? 0.12 : 1 }}
      />

      {/* Tiles */}
      {tiles.map(({ i, r, c, dist }) => {
        const v = heat?.[i] ?? 0;
        const hot = v >= HOT_TILE;
        let overlay: { className?: string; style: React.CSSProperties; opacity: number | number[] };
        if (split) {
          overlay = {
            style: { backgroundColor: "color-mix(in srgb, var(--signal) 10%, transparent)", outline: "1px solid color-mix(in srgb, var(--signal) 55%, transparent)", outlineOffset: -1 },
            opacity: 1,
          };
        } else if (verdict === "AUTHENTIC") {
          overlay = { style: { backgroundColor: "var(--authentic)" }, opacity: [0, 0.5, 0] };
        } else if (verdict === "EDITED" && showHeat) {
          // Changed regions: hatching in ochre (light change) → red (heavy).
          // Untouched regions: veiled with paper, so the edits stand out.
          overlay = hot
            ? {
                className: "hatch",
                style: {
                  color: v > 0.5 ? "var(--fake)" : "var(--edited)",
                  backgroundColor: `color-mix(in srgb, ${v > 0.5 ? "var(--fake)" : "var(--edited)"} 18%, transparent)`,
                  outline: `1.5px solid ${v > 0.5 ? "var(--fake)" : "var(--edited)"}`,
                  outlineOffset: -1,
                  zIndex: 1,
                },
                opacity: 0.55 + 0.45 * Math.min(1, v * 2),
              }
            : { style: { backgroundColor: "var(--paper)" }, opacity: 0.6 };
        } else if (verdict === "UNVERIFIED") {
          overlay = { style: { backgroundColor: "var(--fake)" }, opacity: [0, 0.4, 0.1] };
        } else {
          overlay = { style: {}, opacity: 0 };
        }

        return (
          <motion.div
            key={i}
            className="absolute"
            style={{
              left: pct(c),
              top: pct(r),
              width: pct(1),
              height: pct(1),
              backgroundImage: `url(${src})`,
              backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
              backgroundPosition: `${(c / (gridSize - 1)) * 100}% ${(r / (gridSize - 1)) * 100}%`,
            }}
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: split ? 0.82 : 1, opacity: split || verdict ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22, delay: dist * (split ? 0.025 : 0.018) }}
          >
            <motion.div
              className={`absolute inset-0 ${overlay.className ?? ""}`}
              style={overlay.style}
              animate={{ opacity: overlay.opacity }}
              transition={{
                duration: Array.isArray(overlay.opacity) ? 1.1 : 0.5,
                delay: verdict && !split ? 0.25 + dist * 0.045 : 0,
                ease: "easeOut",
              }}
            />
          </motion.div>
        );
      })}

      {/* Scan line: the whole layer is translated, so it is GPU-composited */}
      {scanning && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          initial={{ y: "-6%" }}
          animate={{ y: ["-6%", "100%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: [0.45, 0, 0.55, 1] }}
        >
          <div className="h-20 -translate-y-full bg-gradient-to-b from-transparent to-signal/25" />
          <div className="relative -mt-px h-[2px] bg-signal">
            <span className="absolute -top-5 left-2 bg-signal px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-signal-ink">
              scanning
            </span>
          </div>
        </motion.div>
      )}

      {/* UNVERIFIED: corrupted-signal glitch bands */}
      {verdict === "UNVERIFIED" && !scanning && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="glitch-a absolute inset-0 mix-blend-multiply dark:mix-blend-screen"
            style={{ backgroundImage: `linear-gradient(var(--fake), var(--fake)), url(${src})`, backgroundBlendMode: "multiply", backgroundSize: "100% 100%" }}
          />
          <div
            className="glitch-b absolute inset-0 opacity-80"
            style={{ backgroundImage: `url(${src})`, backgroundSize: "100% 100%", filter: "grayscale(1) contrast(1.6)" }}
          />
        </div>
      )}

      {/* The verdict stamp lands on the exhibit */}
      {stamp && !scanning && (
        <div
          className={`pointer-events-none absolute z-20 ${verdict === "EDITED" ? "right-3 top-3 sm:right-5 sm:top-5" : "inset-0 grid place-items-center"}`}
        >
          <Stamp label={stamp.label} sub={stamp.sub} tone={stamp.tone} size={verdict === "EDITED" ? "md" : "lg"} slam delay={0.35} className="bg-paper/80" />
        </div>
      )}
      {/* Forensic loupe */}
      {canLoupe && (
        <div
          ref={loupe}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-30 rounded-full border-2 border-ink opacity-0 shadow-[0_10px_30px_rgb(0_0_0/0.35)] transition-opacity duration-150"
          style={{ width: LOUPE, height: LOUPE, backgroundImage: `url(${src})`, backgroundRepeat: "no-repeat" }}
        >
          <span className="absolute left-1/2 top-3 h-[calc(50%-18px)] w-px -translate-x-1/2 bg-paper/80 mix-blend-difference" />
          <span className="absolute bottom-3 left-1/2 h-[calc(50%-18px)] w-px -translate-x-1/2 bg-paper/80 mix-blend-difference" />
          <span className="absolute left-3 top-1/2 h-px w-[calc(50%-18px)] -translate-y-1/2 bg-paper/80 mix-blend-difference" />
          <span className="absolute right-3 top-1/2 h-px w-[calc(50%-18px)] -translate-y-1/2 bg-paper/80 mix-blend-difference" />
          <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold text-paper">
            ×{ZOOM}
          </span>
        </div>
      )}
    </div>
  );
}
