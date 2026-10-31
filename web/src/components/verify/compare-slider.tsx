"use client";

// Before/after slider: the registered ORIGINAL on the left, the uploaded file
// on the right. Drag the handle (or use arrow keys) to wipe between them.
//
// Built on a native <input type="range"> stretched over the images (invisible),
// so mouse, touch and keyboard all work and screen readers announce the value.
//
// When the file is a cropped, mirrored or rotated copy, the original is turned
// and cut the same way first (in a canvas, from the server's alignment), so
// the two sides line up and the wipe compares like with like.
import { useEffect, useState } from "react";
import type { DiffSummary } from "@/lib/api-types";

type Geometry = NonNullable<DiffSummary["geometry"]>;

/** Rotates (clockwise), mirrors and crops an image exactly like the server's alignment did. */
async function alignedOriginal(src: string, g: Geometry): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const turned = g.rotation === 90 || g.rotation === 270;
  const W = turned ? img.naturalHeight : img.naturalWidth;
  const H = turned ? img.naturalWidth : img.naturalHeight;
  const full = document.createElement("canvas");
  full.width = W;
  full.height = H;
  const f = full.getContext("2d")!;
  f.translate(W / 2, H / 2);
  if (g.mirrored) f.scale(-1, 1);
  f.rotate((g.rotation * Math.PI) / 180);
  f.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(g.rect.w * W));
  out.height = Math.max(1, Math.round(g.rect.h * H));
  out.getContext("2d")!.drawImage(full, g.rect.x * W, g.rect.y * H, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("canvas export failed");
  return URL.createObjectURL(blob);
}

const tag = "pointer-events-none absolute top-2 bg-paper px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink";

export function CompareSlider({
  original,
  suspect,
  aspect,
  geometry,
}: {
  original: string;
  suspect: string;
  aspect: number;
  geometry?: DiffSummary["geometry"];
}) {
  const [pos, setPos] = useState(50);
  const [aligned, setAligned] = useState<{ for: string; url: string } | null>(null);
  const key = geometry ? `${original}|${JSON.stringify(geometry)}` : null;

  useEffect(() => {
    if (!geometry || !key) return;
    let url: string | null = null;
    let cancelled = false;
    alignedOriginal(original, geometry)
      .then((u) => {
        url = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setAligned({ for: key, url: u });
      })
      .catch(() => undefined); // fall back to the plain original
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [original, geometry, key]);

  const shownOriginal = aligned && aligned.for === key ? aligned.url : original;

  return (
    <div className="relative w-full overflow-hidden border border-ink" style={{ aspectRatio: aspect }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL */}
      <img src={suspect} alt="Uploaded image" className="absolute inset-0 size-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic API image */}
      <img
        src={shownOriginal}
        alt={geometry ? "Registered original, aligned to this file" : "Registered original"}
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

      <span className={`${tag} left-2`}>{geometry ? "Original (aligned)" : "Original"}</span>
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
