"use client";

// "Decrypting" text effect: characters cycle through random hex digits and
// lock into place left to right. Used for hashes and signatures as they are
// computed. With reduced motion the final text appears immediately.
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

const GLYPHS = "0123456789abcdef";

export function ScrambleText({
  text,
  durationMs = 700,
  className,
}: {
  text: string;
  durationMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (reduce) return; // the final text is rendered directly below
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const locked = Math.floor(progress * text.length);
      let out = text.slice(0, locked);
      for (let i = locked; i < text.length; i++) {
        // Keep "0x", spaces and punctuation stable; scramble only the hex digits.
        out += /[0-9a-f]/i.test(text[i]) && i > 1 ? GLYPHS[(Math.random() * 16) | 0] : text[i];
      }
      setShown(out);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, durationMs, reduce]);

  return (
    <span className={className} aria-label={text}>
      {reduce ? text : shown}
    </span>
  );
}
