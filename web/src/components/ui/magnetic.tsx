"use client";

// Magnetic hover: the wrapped element leans towards the cursor while it's
// nearby and springs back when it leaves. Used on the main call-to-action
// buttons. Does nothing for touch input or with reduced motion.
import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";

export function Magnetic({ children, strength = 0.32, className = "" }: { children: React.ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);
  const x = useSpring(dx, { stiffness: 260, damping: 18 });
  const y = useSpring(dy, { stiffness: 260, damping: 18 });

  return (
    <motion.span
      ref={ref}
      className={`inline-block ${className}`}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        dx.set((e.clientX - (r.left + r.width / 2)) * strength);
        dy.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        dx.set(0);
        dy.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
