"use client";

// A headline set like a ransom note: every letter is cut out of a different
// "magazine", in its own font, size, paper colour and tilt.
//
// Everything is DETERMINISTIC (derived from the letter's position, never
// Math.random()), so the server and the browser render exactly the same
// letters and React never sees a hydration mismatch.
//
//   font      cycled from FONTS
//   size      cycled from SIZES (px on desktop, scaled down with clamp() on phones)
//   colour    cycled from the theme's --cut-1..6 palette; each has a matching
//             --cut-N-ink text colour chosen for contrast, so it works in both themes
//   tilt      -6°..+6° from a small integer hash of the index
//   motion    letters drop in one by one, then "jiggle" (CSS, staggered);
//             hovering a letter pops it up straight
//
// Accessibility: the <h1> carries the real sentence as its aria-label and the
// cut-outs are aria-hidden, so screen readers read "Every pixel has a witness",
// not 22 separate letters. Reduced motion: no drop-in, no jiggle.
import { motion } from "framer-motion";

const FONTS = [
  "var(--font-anton), Impact, sans-serif",
  "var(--nf-abril), Georgia, serif",
  "var(--nf-bungee), Impact, sans-serif",
  "var(--nf-elite), 'Courier New', monospace",
  "Georgia, 'Times New Roman', serif",
];
const SIZES = [58, 64, 70, 76, 82];
const COLOURS = 6; // --cut-1 .. --cut-6

/** -6..+6 degrees, spread so neighbouring letters lean different ways. */
const tilt = (i: number) => ((i * 7 + 3) % 13) - 6;

type Cut = { ch: string; i: number };

/** Sentence → words → letters, each letter with a running index. */
function cutUp(text: string): Cut[][] {
  let i = 0;
  const words: Cut[][] = [];
  for (const word of text.split(" ")) {
    const letters: Cut[] = [];
    for (const ch of Array.from(word)) letters.push({ ch, i: i++ });
    words.push(letters);
  }
  return words;
}

export function RansomText({ text, className = "" }: { text: string; className?: string }) {
  const words = cutUp(text.toUpperCase());

  return (
    <h1 aria-label={text} className={`flex flex-wrap items-center gap-x-7 gap-y-3 sm:gap-x-10 ${className}`}>
      {words.map((letters, w) => (
        // A word never breaks across lines; the gap between words is extra wide.
        <span key={w} aria-hidden className="inline-flex flex-nowrap items-center gap-[3px]">
          {letters.map(({ ch, i }) => {
            const size = SIZES[(i * 2) % SIZES.length];
            const colour = (i * 5) % COLOURS + 1;
            return (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: -40, scale: 1.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.15 + i * 0.045 }}
              >
                <span
                  className="ransom-jiggle"
                  style={{ "--rot": `${tilt(i)}deg`, animationDelay: `${-(i * 0.17).toFixed(2)}s` } as React.CSSProperties}
                >
                  <span
                    className="ransom-cut"
                    style={{
                      fontFamily: FONTS[i % FONTS.length],
                      // Full size from ~1150px wide; shrinks with the screen; never below 55%.
                      fontSize: `clamp(${Math.round(size * 0.55)}px, ${(size / 14).toFixed(2)}vw, ${size}px)`,
                      background: `var(--cut-${colour})`,
                      color: `var(--cut-${colour}-ink)`,
                    }}
                  >
                    {ch}
                  </span>
                </span>
              </motion.span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}
