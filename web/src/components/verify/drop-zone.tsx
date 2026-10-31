"use client";

// Drag-and-drop / click / paste target for the image to verify: a specimen
// tray with marching ink dashes and registration crosshairs in the corners.
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Stamp } from "@/components/ui/stamp";
import { label } from "@/components/ui/styles";

function Crosshair({ className }: { className: string }) {
  return (
    <span aria-hidden className={`absolute size-5 ${className}`}>
      <span className="absolute left-1/2 top-0 h-full w-px bg-ink" />
      <span className="absolute left-0 top-1/2 h-px w-full bg-ink" />
      <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink" />
    </span>
  );
}

export function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Paste an image from the clipboard anywhere on the page (Ctrl/Cmd + V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  return (
    <motion.button
      type="button"
      data-cursor={over ? "Release" : "Drop"}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={`group relative flex min-h-[340px] w-full flex-col items-center justify-center overflow-hidden p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal sm:min-h-[400px] ${
        over ? "bg-signal/10" : "bg-sheet hover:bg-paper"
      }`}
    >
      <span aria-hidden className="dropzone-border pointer-events-none absolute inset-0" />
      <Crosshair className="left-4 top-4" />
      <Crosshair className="right-4 top-4" />
      <Crosshair className="bottom-4 left-4" />
      <Crosshair className="bottom-4 right-4" />

      <span className={label}>Specimen tray</span>
      <motion.span
        animate={{ scale: over ? 1.04 : 1 }}
        className="mt-4 font-display text-5xl leading-none sm:text-7xl"
      >
        {over ? (
          <>
            Release to <em className="text-signal">examine</em>
          </>
        ) : (
          <>
            Drop an image to <em className="text-signal">verify</em>
          </>
        )}
      </motion.span>
      <span className="mt-5 text-muted">
        or <span className="text-ink underline decoration-signal decoration-2 underline-offset-4 group-hover:text-signal">choose a file</span>
        <span className="hidden sm:inline"> · or paste with Ctrl+V</span>
      </span>
      <span className={`mt-6 ${label}`}>JPEG · PNG · WebP · max 15 MB</span>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </motion.button>
  );
}

/** The three possible outcomes, explained up-front so users know what a verdict means. */
export function VerdictLegend() {
  const items = [
    { stamp: "Authentic", tone: "authentic" as const, body: "Exact SHA-256 match with an on-chain record and a valid device signature. Not one bit changed." },
    { stamp: "Edited", tone: "edited" as const, body: "Visually matches a registered original but the bytes differ. We show which regions changed." },
    { stamp: "Unverified", tone: "fake" as const, body: "No provenance record. Its origin can't be proven, which is not the same as proven fake." },
  ];
  return (
    <div className="grid border-y border-ink md:grid-cols-3 md:divide-x md:divide-rule">
      {items.map((it, i) => (
        <motion.div
          key={it.stamp}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.08 }}
          className="flex items-start gap-4 border-b border-rule py-5 last:border-0 md:border-0 md:px-5 md:first:pl-0"
        >
          <Stamp label={it.stamp} tone={it.tone} size="sm" rotate={-5} className="mt-1 shrink-0" />
          <p className="text-sm text-muted">{it.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
