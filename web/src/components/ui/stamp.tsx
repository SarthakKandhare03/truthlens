"use client";

// A rubber stamp, the visual language for verdicts ("AUTHENTIC", "EDITED",
// "SEALED"…). A heavy border, condensed capitals, a slight tilt and an ink mask
// that knocks random specks out so it looks printed rather than rendered.
// With `slam`, it drops onto the page like a real stamp: on mount, or with
// slam="view" when it scrolls into view. It wobbles a little on hover.
import { motion } from "framer-motion";

export type StampTone = "authentic" | "edited" | "fake" | "ink" | "signal" | "alarm";

const TONE: Record<StampTone, string> = {
  authentic: "text-authentic",
  edited: "text-edited",
  fake: "text-fake",
  ink: "text-ink",
  signal: "text-signal",
  alarm: "text-alarm",
};

export function Stamp({
  label,
  sub,
  tone = "ink",
  rotate = -7,
  size = "md",
  slam = false,
  delay = 0,
  className = "",
}: {
  label: string;
  sub?: string;
  tone?: StampTone;
  rotate?: number;
  size?: "sm" | "md" | "lg";
  slam?: boolean | "view";
  delay?: number;
  className?: string;
}) {
  const text = { sm: "text-lg px-2.5 py-1", md: "text-3xl px-4 py-1.5", lg: "text-5xl sm:text-6xl px-6 py-2" }[size];

  return (
    <motion.div
      aria-label={sub ? `${label}, ${sub}` : label}
      role="img"
      className={`inline-block select-none ${TONE[tone]} ${className}`}
      initial={slam ? { scale: 2.4, opacity: 0, rotate: rotate - 10 } : false}
      {...(slam === "view"
        ? { whileInView: { scale: 1, opacity: 1, rotate }, viewport: { once: true, margin: "-60px" } }
        : { animate: { scale: 1, opacity: 1, rotate } })}
      whileHover={{ rotate: rotate + 4, scale: 1.06 }}
      transition={slam ? { type: "spring", stiffness: 420, damping: 22, delay } : { type: "spring", stiffness: 300, damping: 14 }}
      style={{ rotate }}
    >
      <div className={`stamp-ink border-[3px] border-current text-center ${text}`}>
        <div className="font-display leading-[1.05] tracking-[0.02em]">{label}</div>
        {sub && <div className="mt-1 mb-0.5 font-mono text-[0.26em] font-semibold uppercase leading-none tracking-[0.35em]">{sub}</div>}
      </div>
    </motion.div>
  );
}
