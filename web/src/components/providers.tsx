"use client";

// App-wide client setup.
//
// reducedMotion="user": when the operating system asks for reduced motion,
// Framer Motion skips transform/layout animations everywhere (opacity fades
// still run). Components with bespoke effects (laser, glitch, scramble,
// cursor) also check useReducedMotion() themselves.
import { MotionConfig } from "framer-motion";
import { Cursor } from "./cursor";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
      <Cursor />
    </MotionConfig>
  );
}
