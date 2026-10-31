"use client";

// Two strips of caution tape crossing the page in an X, their printed words
// drifting in opposite directions. Scroll speed is fed in: scroll fast and
// the tapes race and the type skews, then they ease back to a drift.
//
// Built on Framer Motion's scroll velocity: useScroll → useVelocity →
// useSpring (smoothing) → a speed factor applied on every animation frame.
// Reduced motion: the rows stand still.
import { useRef } from "react";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion";

/** Keeps v inside [min, max), wrapping around, for a seamless loop. */
const wrap = (min: number, max: number, v: number) => {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
};

function Tape({ words, baseVelocity, className }: { words: string[]; baseVelocity: number; className: string }) {
  const reduce = useReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const factor = useTransform(velocity, [0, 1000], [0, 5], { clamp: false });
  const skew = useTransform(velocity, [-2500, 2500], [10, -10]);
  const direction = useRef(1);

  // The row is 4 copies wide; moving it by one copy (25%) loops seamlessly.
  const x = useTransform(baseX, (v) => `${wrap(-25, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const f = factor.get();
    if (f < 0) direction.current = -1;
    else if (f > 0) direction.current = 1;
    const move = direction.current * baseVelocity * (delta / 1000) * (1 + Math.abs(f));
    baseX.set(baseX.get() + move);
  });

  return (
    <div className={`absolute -left-[10%] flex w-[120%] overflow-hidden whitespace-nowrap bg-tape text-tape-ink shadow-[0_12px_28px_rgb(0_0_0/0.4)] ${className}`}>
      {/* thin stripe borders along both edges of the tape */}
      <div aria-hidden className="hazard absolute inset-x-0 top-0 h-1.5" />
      <div aria-hidden className="hazard absolute inset-x-0 bottom-0 h-1.5" />
      <motion.div className="flex py-3" style={{ x, skewX: reduce ? 0 : skew }}>
        {[0, 1, 2, 3].map((copy) => (
          <span key={copy} className="flex shrink-0" aria-hidden={copy > 0}>
            {words.map((w, i) => (
              <span key={i} className="font-display pr-[0.6em] text-[clamp(2rem,5.2vw,4.4rem)] leading-none">
                {w}
              </span>
            ))}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export function VelocityMarquee() {
  return (
    <section aria-label="Evidence. Do not tamper. Sealed on-chain." className="relative -mx-4 h-[250px] overflow-hidden sm:-mx-6 sm:h-[400px]">
      <Tape
        className="top-1/2 -translate-y-1/2 -rotate-[6deg]"
        words={["Evidence", "✕", "do not tamper", "✕", "sealed on-chain", "✕"]}
        baseVelocity={-2.2}
      />
      <Tape
        className="top-1/2 -translate-y-1/2 rotate-[5deg]"
        words={["Case N°001", "●", "signed at the shutter", "●", "hash or it didn't happen", "●"]}
        baseVelocity={2.2}
      />
    </section>
  );
}
