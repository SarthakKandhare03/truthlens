"use client";

// A short label that "decodes" when hovered: letters flicker through random
// characters and resolve left to right. Screen readers always get the real
// word (visually hidden text); the animated copy is hidden from them.
// Off with reduced motion.
import { useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&";

export function ScrambleLabel({ text, className = "" }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(text);
  const frame = useRef(0);

  const run = () => {
    if (reduce) return;
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    const duration = 380;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const locked = Math.floor(p * text.length);
      let out = text.slice(0, locked);
      for (let i = locked; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setShown(out);
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  return (
    <span className={className} onPointerEnter={run}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{shown}</span>
    </span>
  );
}
