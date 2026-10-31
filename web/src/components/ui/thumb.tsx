"use client";

// Thumbnail of a registered image (/api/images/:sha?w=…) with a graceful
// fallback. The chain can hold a record whose original is missing from
// storage (e.g. web/storage was deleted); then we show a calm placeholder
// instead of the browser's broken-image icon.
import { useCallback, useState } from "react";
import { ImageOff } from "lucide-react";

export function Thumb({
  sha256,
  width,
  alt = "",
  className = "",
  fit = "cover",
}: {
  sha256: string;
  width: 160 | 320 | 640;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);

  // An image that fails BEFORE React hydrates never fires onError, so also
  // check its state once it is attached to the page.
  const checkAlreadyFailed = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-sheet text-muted ${className}`} role="img" aria-label="Image unavailable">
        <ImageOff className="size-5" />
        <span className="font-mono text-[9px] uppercase tracking-[0.2em]">unavailable</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own API, already resized
    <img
      ref={checkAlreadyFailed}
      src={`/api/images/${sha256}?w=${width}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
    />
  );
}
