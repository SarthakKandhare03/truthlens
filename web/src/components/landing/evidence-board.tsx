"use client";

// The hero's evidence cluster: the whole idea of TruthLens told as a
// detective's pin-board.
//
//   Exhibit A   polaroid of the original, a live 3D eye (three.js), "device signed"
//   Exhibit B   polaroid of a suspect copy: the same eye with sliced, red-printed
//               bands (the edited region), "hash mismatch", under a magnifying glass
//   WANTED      a cut-out poster: one deepfake, for impersonating reality
//   Seal card   the LATEST REAL SEAL from the chain (hash and block are streamed
//               in from the server, never hard-coded)
//   Stamp       VERIFIED · ON-CHAIN, thumping every 3 s
//   Red string  joins the glowing pins
//
// Interaction: with a mouse, every item can be picked up and thrown around the
// board (Framer Motion drag, kept inside the board), and the strings follow.
// The strings are drawn by measuring where the pins actually are on every
// animation frame and writing the SVG path directly (no React re-render), so
// they stay attached through rotation, dragging and the springy release.
// Touch screens get a still board, so dragging never fights page scrolling.
import { useRef, useState, useSyncExternalStore } from "react";
import { motion, useAnimationFrame } from "framer-motion";
import { Check, X } from "lucide-react";
import { shortHash } from "@/lib/client/format";
import { Stamp } from "@/components/ui/stamp";
import { HeroCanvas } from "./hero-canvas";

/** Fixed "film" palette for the photos, so they look the same in both themes. */
const FILM = {
  "--ink": "#ece3cf",
  "--signal": "#ffd60a",
  "--muted": "#8c8371",
  "--paper": "#1c1915",
  "--alarm": "#ff3348",
} as React.CSSProperties;

/** Pins, marked in the DOM with data-anchor="N". */
const ANCHOR = { a: 0, b: 1, wanted: 2, seal: 3, stamp: 4 } as const;
const PINNED = [ANCHOR.a, ANCHOR.b, ANCHOR.wanted, ANCHOR.seal]; // the stamp has no pin; the string just touches it
/** Pairs of pins joined by red string. */
const STRINGS: [number, number][] = [
  [ANCHOR.a, ANCHOR.b],
  [ANCHOR.a, ANCHOR.wanted],
  [ANCHOR.b, ANCHOR.seal],
  [ANCHOR.wanted, ANCHOR.seal],
  [ANCHOR.seal, ANCHOR.stamp],
];

const PAPER = "#f3ead8"; // card stock, the same in both themes
const PAPER_INK = "#1a1714";

const finePointer = (onChange: () => void) => {
  const mq = window.matchMedia("(pointer: fine)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

export function EvidenceBoard({ tag }: { tag: React.ReactNode }) {
  const board = useRef<HTMLDivElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const heads = useRef<(SVGGElement | null)[]>([]);
  const [top, setTop] = useState(-1); // the item picked up last sits on top
  const canDrag = useSyncExternalStore(finePointer, () => window.matchMedia("(pointer: fine)").matches, () => false);

  // Re-measure the pins and redraw the strings every frame.
  useAnimationFrame((t) => {
    const host = board.current;
    if (!host) return;
    const b = host.getBoundingClientRect();
    const pts = Object.values(ANCHOR).map((i) => {
      const r = host.querySelector(`[data-anchor="${i}"]`)?.getBoundingClientRect();
      // A hidden item (the WANTED card on phones) measures 0×0: no pin, no string.
      return r && r.width > 0 ? { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top } : null;
    });
    STRINGS.forEach(([i, j], k) => {
      const p = pts[i];
      const q = pts[j];
      const path = paths.current[k];
      if (!path) return;
      if (!p || !q) {
        path.setAttribute("d", "");
        return;
      }
      // A slack string sags under its own weight, and sways very slightly.
      const sag = Math.min(46, Math.hypot(q.x - p.x, q.y - p.y) * 0.14) * (1 + 0.06 * Math.sin(t / 700 + k * 2));
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2 + sag;
      path.setAttribute("d", `M${p.x.toFixed(1)} ${p.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
    });
    pts.forEach((p, i) => {
      const head = heads.current[i];
      if (!head) return;
      head.style.display = p ? "" : "none";
      if (p) head.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    });
  });

  /** Shared props for a pinned, draggable item. */
  const item = (i: number, rotate: number, delay: number) => ({
    drag: canDrag,
    dragElastic: 0.18,
    onDragStart: () => setTop(i),
    initial: { opacity: 0, scale: 1.25, rotate: rotate + 14 },
    animate: { opacity: 1, scale: 1, rotate },
    whileHover: canDrag ? { scale: 1.03 } : undefined,
    whileDrag: { scale: 1.07, rotate: 0, cursor: "grabbing" },
    transition: { type: "spring" as const, stiffness: 260, damping: 20, delay },
    style: { zIndex: top === i ? 30 : 10 },
    "data-cursor": canDrag ? "Drag" : undefined,
  });

  return (
    <div
      ref={board}
      role="img"
      aria-label="Evidence board: an original photo signed by its device, a suspect copy whose hash does not match, a wanted poster for a deepfake, the latest seal on the ledger, stamped verified on-chain."
      className="@container relative mx-auto aspect-[1/0.95] w-full max-w-[680px] select-none min-[900px]:aspect-[1.08/1]"
    >
      <div aria-hidden>
        {/* Exhibit A: the original */}
        <motion.div {...item(0, -7, 0.35)} dragConstraints={board} className="absolute left-[4%] top-[2%] w-[44%] min-[900px]:left-[13%] min-[900px]:w-[37%]">
          <Polaroid
            anchor={ANCHOR.a}
            label="Original"
            caption={
              <>
                device signed <Check className="inline size-[1.1em] align-[-0.15em]" strokeWidth={3} />
              </>
            }
            photo={<HeroCanvas variant="original" />}
          />
        </motion.div>

        {/* Exhibit B: the suspect copy */}
        <motion.div {...item(1, 7, 0.55)} dragConstraints={board} className="absolute left-[52%] top-[8%] w-[43%] min-[900px]:left-[58%] min-[900px]:top-[10%] min-[900px]:w-[36%]">
          <Polaroid
            anchor={ANCHOR.b}
            label="Suspect"
            caption={
              <span className="text-[#d7102f]">
                hash mismatch <X className="inline size-[1.1em] align-[-0.15em]" strokeWidth={3} />
              </span>
            }
            photo={<HeroCanvas variant="suspect" />}
          />
        </motion.div>

        {/* Magnifying glass over the suspect */}
        <motion.div {...item(5, -14, 0.9)} dragConstraints={board} className="absolute left-[44%] top-[26%] w-[27%] min-[900px]:left-[52%] min-[900px]:top-[28%] min-[900px]:w-[23%]">
          <Magnifier />
        </motion.div>

        {/* WANTED poster (hidden on narrow screens) */}
        <motion.div {...item(2, -4, 0.7)} dragConstraints={board} className="absolute left-[1%] top-[57%] hidden w-[29%] min-[900px]:block">
          <div className="relative px-[2.4cqw] pb-[2cqw] pt-[3.4cqw] text-center shadow-[0_14px_30px_rgb(0_0_0/0.45)]" style={{ background: PAPER, color: PAPER_INK }}>
            <span data-anchor={ANCHOR.wanted} className="absolute left-1/2 top-[1.6cqw] size-[2.6cqw] -translate-x-1/2" />
            <p className="font-abril text-[4.9cqw] leading-none">WANTED</p>
            <p className="mt-[0.6cqw] font-elite text-[1.9cqw] uppercase tracking-[0.2em]">one deepfake</p>
            <div className="hatch mt-[1.4cqw] grid aspect-[4/3] place-items-center text-[#1a1714]/25">
              <span className="bg-[#f3ead8] px-[1cqw] font-mono text-[1.6cqw] tracking-[0.25em] text-[#1a1714]/70">[ DEEPFAKE ]</span>
            </div>
            <p className="mt-[1.4cqw] font-elite text-[1.9cqw] leading-tight">for impersonating reality</p>
          </div>
        </motion.div>

        {/* Seal card: the latest real seal */}
        <motion.div {...item(3, -3, 0.8)} dragConstraints={board} className="absolute left-[8%] top-[55%] w-[58%] min-[900px]:left-[36%] min-[900px]:top-[64%] min-[900px]:w-[40%]">
          <div className="relative bg-[#fff3a8] px-[3.4cqw] pb-[2.6cqw] pt-[3.8cqw] text-[#1a1714] shadow-[0_14px_30px_rgb(0_0_0/0.45)]">
            <span data-anchor={ANCHOR.seal} className="absolute left-1/2 top-[1.6cqw] size-[2.6cqw]" />
            {tag}
          </div>
        </motion.div>

        {/* The verdict, thumping */}
        <motion.div {...item(4, 0, 0)} dragConstraints={board} initial={false} animate={{ rotate: 0 }} className="absolute left-[62%] top-[76%] min-[900px]:left-[71%] min-[900px]:top-[83%]">
          {/* The anchor sits inside the scaled box, so the string meets the stamp at any size. */}
          <div className="relative origin-top-left scale-[0.72] @md:scale-100">
            <span data-anchor={ANCHOR.stamp} className="absolute left-[30%] top-[10%] size-1" />
            <div className="stamp-pulse">
              <Stamp label="Verified" sub="On-chain" tone="alarm" rotate={-12} slam delay={1.2} className="bg-[#f3ead8]/85" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Red string and glowing pin heads, above the cards (the glow is for the dark theme) */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-40 size-full overflow-visible dark:drop-shadow-[0_0_5px_rgb(255_45_85/0.85)]"
      >
        {STRINGS.map((_, k) => (
          <path
            key={k}
            ref={(el) => {
              paths.current[k] = el;
            }}
            pathLength={1}
            className="string-draw"
            style={{ animationDelay: `${-k * 0.6}s` }}
            fill="none"
            stroke="var(--rn-red)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {PINNED.map((i) => (
          <g
            key={i}
            ref={(el) => {
              heads.current[i] = el;
            }}
          >
            <circle r={13} fill="var(--rn-red)" opacity={0.25} />
            <circle r={8} fill="var(--rn-red)" />
            <circle r={2.8} fill="#ffffff" opacity={0.75} cx={-2.4} cy={-2.4} />
          </g>
        ))}
      </svg>
    </div>
  );
}

function Polaroid({
  anchor,
  label,
  caption,
  photo,
}: {
  anchor: number;
  label: string;
  caption: React.ReactNode;
  photo: React.ReactNode;
}) {
  return (
    <div className="relative p-[3cqw] pb-[2.4cqw] shadow-[0_18px_40px_rgb(0_0_0/0.5)]" style={{ background: PAPER }}>
      <span data-anchor={anchor} className="absolute left-1/2 top-[1.8cqw] size-[2.6cqw] -translate-x-1/2" />
      <div className="relative aspect-[1/0.92] overflow-hidden bg-[#1c1915] shadow-[inset_0_0_30px_rgb(0_0_0/0.6)]" style={FILM}>
        {photo}
        <span className="absolute bottom-[1.5cqw] left-[2cqw] font-mono text-[1.6cqw] uppercase tracking-[0.25em] text-[#8c8371]">
          [ {label} ]
        </span>
      </div>
      <p className="mt-[1.8cqw] font-elite text-[2.9cqw] leading-none" style={{ color: PAPER_INK }}>
        {caption}
      </p>
    </div>
  );
}

/** A magnifying glass: dark rim, tinted glass, a striped TAMPERED label, a handle. */
function Magnifier() {
  return (
    <div className="relative aspect-square">
      <span className="absolute left-[80%] top-[80%] h-[16%] w-[62%] origin-left rotate-45 rounded-full bg-[#141418] shadow-[0_8px_18px_rgb(0_0_0/0.5)]" />
      <div className="relative grid size-full place-items-center overflow-hidden rounded-full border-[1.6cqw] border-[#141418] bg-[rgb(20_20_28/0.45)] shadow-[0_14px_34px_rgb(0_0_0/0.55),inset_0_0_24px_rgb(255_255_255/0.18)]">
        <span className="rotate-[-8deg] border-[0.4cqw] border-white bg-[repeating-linear-gradient(-45deg,#d7102f_0_1.2cqw,#a50d25_1.2cqw_2.4cqw)] px-[1.6cqw] py-[0.6cqw] font-display text-[3.2cqw] leading-none tracking-[0.04em] text-white shadow-[0_4px_10px_rgb(0_0_0/0.4)]">
          TAMPERED
        </span>
        {/* glare */}
        <span className="pointer-events-none absolute left-[18%] top-[12%] h-[22%] w-[38%] rotate-[-30deg] rounded-full bg-white/25 blur-[2px]" />
      </div>
    </div>
  );
}

/** The typed lines on the seal card (the newest seal). Without one yet, says so. */
export function EvidenceTag({ sha256, block }: { sha256?: string; block?: number }) {
  return (
    <div className="font-elite text-[2.5cqw] leading-[1.75] min-[900px]:text-[2.1cqw]">
      <p className="font-mono text-[1.6cqw] font-semibold uppercase tracking-[0.3em] opacity-60">Latest seal · ledger</p>
      <p>SHA-256: {sha256 ? shortHash(sha256, 6, 4) : "awaiting first seal"}</p>
      <p>
        SIG: ECDSA P-256{" "}
        {sha256 ? <Check className="inline size-[1.1em] align-[-0.15em]" strokeWidth={3} aria-label="valid" /> : "—"}
      </p>
      <p>BLOCK: #{block ?? "—"}</p>
    </div>
  );
}
