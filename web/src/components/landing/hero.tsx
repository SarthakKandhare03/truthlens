"use client";

// Landing hero, "Ransom Note Evidence Board": a typed threat ("We have your
// photo…"), the headline cut out letter by letter like a ransom note, two
// chunky buttons, and the evidence cluster (polaroids, WANTED poster, latest
// seal, stamp, red string) on the right. Below 900px wide the two stack.
//
// Backdrop, per theme (both full-bleed, behind the hero only):
//   dark   "Midnight Flash": near-black, a red glow left and a blue glow right,
//          a fine white halftone, and a camera flash every ~5 s
//   light  "Riso Zine": cream paper, a giant pink halftone circle with a blue
//          copy printed slightly out of register (it wobbles), a yellow block
//
// On scroll the text and the board drift apart (parallax). The live counters
// arrive as `stats` and the seal card's real data as `tag`, both
// server-rendered and streamed in.
import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { label } from "@/components/ui/styles";
import { Magnetic } from "@/components/ui/magnetic";
import { EvidenceBoard } from "./evidence-board";
import { RansomText } from "./ransom-text";

/** Chunky buttons with a hard offset shadow; pressing pushes them into it. */
const chunky =
  "inline-flex items-center justify-center gap-2 border-2 border-[var(--rn-ink)] px-6 py-3.5 font-spacemono text-[15px] font-bold transition-[transform,box-shadow] duration-150 outline-none hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none focus-visible:ring-2 focus-visible:ring-[var(--rn-blue)] focus-visible:ring-offset-2";
const chunkyPrimary = `${chunky} bg-[var(--rn-ink)] text-[var(--rn-base)] shadow-[5px_5px_0_0_var(--rn-red)] hover:shadow-[8px_8px_0_0_var(--rn-red)]`;
const chunkyOutline = `${chunky} bg-[var(--rn-base)] text-[var(--rn-ink)] shadow-[5px_5px_0_0_var(--rn-blue)] hover:shadow-[8px_8px_0_0_var(--rn-blue)]`;

export function Hero({ stats, tag }: { stats: React.ReactNode; tag: React.ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "-14%"]);
  const boardY = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);

  return (
    <section ref={section} className="relative isolate mx-auto w-full max-w-7xl">
      <Backdrop />

      <div className="grid items-center gap-12 pt-2 min-[900px]:grid-cols-[1fr_1.08fr] min-[900px]:gap-6 min-[900px]:pt-6">
        <motion.div style={{ y: textY }}>
          <motion.p
            className="inline-block -rotate-1 bg-[#f3ead8] px-3 py-1.5 font-elite text-[15px] text-[#1a1714] shadow-[3px_3px_0_var(--rn-shadow)] sm:text-base"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            We have your photo. We know where it&apos;s been.
          </motion.p>

          <RansomText text="Every pixel has a witness" className="mt-7" />

          <motion.div className="mt-10 flex flex-wrap gap-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }}>
            <Magnetic>
              <Link href="/verify" className={chunkyPrimary} data-cursor="Grill it">
                Verify a photo <ArrowRight className="size-4" />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/explorer" className={chunkyOutline} data-cursor="Read">
                Open the ledger
              </Link>
            </Magnetic>
          </motion.div>
        </motion.div>

        <motion.div style={{ y: boardY }}>
          <EvidenceBoard tag={tag} />
        </motion.div>
      </div>

      <div className="mt-16">{stats}</div>
    </section>
  );
}

/**
 * The full-bleed background behind the hero. It starts right under the
 * masthead (the negative top margin undoes <main>'s padding) and fades into
 * the page colour at the bottom. Purely decorative.
 */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute -top-10 bottom-0 left-1/2 -z-10 -ml-[50vw] w-screen overflow-hidden bg-[var(--rn-base)] sm:-top-14">
      {/* Midnight Flash (dark theme) */}
      <div className="absolute inset-0 hidden dark:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_55%_at_12%_40%,rgb(255_45_85/0.18),transparent_70%),radial-gradient(ellipse_45%_55%_at_88%_30%,rgb(60_90_255/0.16),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1.3px)] bg-[size:5px_5px]" />
        <div className="camera-flash absolute inset-0 bg-white" />
      </div>

      {/* Riso Zine (light theme) */}
      <div className="absolute inset-0 dark:hidden">
        <div
          className="absolute -right-[12%] -top-[22%] size-[62vw] max-h-[900px] max-w-[900px] rounded-full bg-[radial-gradient(#ff3d8b_2.4px,transparent_2.8px)] bg-[size:10px_10px] opacity-80 mix-blend-multiply"
          style={{ maskImage: "radial-gradient(circle, #000 55%, transparent 71%)" }}
        />
        <div
          className="riso-wobble absolute -right-[12%] -top-[22%] size-[62vw] max-h-[900px] max-w-[900px] rounded-full bg-[radial-gradient(#1b2a8f_1.6px,transparent_2px)] bg-[size:10px_10px] opacity-50 mix-blend-multiply"
          style={{ maskImage: "radial-gradient(circle, #000 50%, transparent 68%)" }}
        />
        <div className="absolute -left-[4%] bottom-[8%] h-[34%] w-[30%] -rotate-3 bg-[#ffd23f] opacity-80 mix-blend-multiply" />
      </div>

      {/* Fade into the page below */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[var(--paper)]" />
    </div>
  );
}

/** Same footprint as the live counters while they stream in. */
export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 divide-x divide-rule border-y border-ink">
      {["Images secured", "Blocks written", "Edits tracked"].map((l) => (
        <div key={l} className="px-3 py-5 sm:px-6">
          <p className="font-display text-5xl leading-none text-muted/40 sm:text-7xl">—</p>
          <p className={`mt-2 ${label}`}>{l}</p>
        </div>
      ))}
    </div>
  );
}
