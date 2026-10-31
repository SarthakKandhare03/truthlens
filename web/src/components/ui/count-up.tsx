"use client";

// Number that counts up to `value` (e.g. "12.3% modified", "1,024 images").
// It waits until it scrolls into view, then counts from 0. When `value` changes later (live
// stats), it counts on from the previous value instead of restarting.
// Uses a motion value, so the digits update directly without React re-renders.
import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

export function CountUp({
  value,
  decimals = 1,
  durationS = 1.2,
  grouping = false,
}: {
  value: number;
  decimals?: number;
  durationS?: number;
  grouping?: boolean; // 12,345 instead of 12345
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const format = (v: number) =>
    grouping
      ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : v.toFixed(decimals);

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration: durationS,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- format only depends on grouping/decimals
  }, [value, decimals, durationS, reduce, grouping, inView]);

  return <span ref={ref}>{format(0)}</span>;
}
