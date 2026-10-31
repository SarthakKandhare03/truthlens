"use client";

// Before/after slider: the registered ORIGINAL on the left, the uploaded file
// on the right. Drag the handle (or use arrow keys) to wipe between them.
//
// Built on a native <input type="range"> stretched over the images (invisible),
// so mouse, touch and keyboard all work and screen readers announce the value.
import { useState } from "react";

const tag = "pointer-events-none absolute top-2 bg-paper px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink";

export function CompareSlider({ original, suspect, aspect }: { original: string; suspect: string; aspect: number }) {
  const [pos, setPos] = useState(50);

  return (
    <div className="relative w-full overflow-hidden border border-ink" style={{ aspectRatio: aspect }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL */}
      <img src={suspect} alt="Uploaded image" className="absolute inset-0 size-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic API image */}
      <img
        src={original}
        alt="Registered original"
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      {/* Divider + handle */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -left-[1.5px] w-[3px] bg-paper mix-blend-difference" />
        <div className="absolute left-1/2 top-1/2 flex h-12 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-ink bg-paper">
          <span className="h-5 w-px bg-ink" />
          <span className="ml-1 h-5 w-px bg-ink" />
        </div>
      </div>

      <span className={`${tag} left-2`}>Original</span>
      <span className={`${tag} right-2`}>This file</span>

      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare the registered original with this file"
        className="absolute inset-0 size-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
