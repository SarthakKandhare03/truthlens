// TruthLens mark + wordmark. The mark is a lens in a viewfinder: an outer
// ring with four crosshair ticks and a solid pupil, drawn in the current ink.
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor">
      <circle cx="16" cy="16" r="11" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="6.5" strokeWidth="1.2" strokeDasharray="2.2 1.6" />
      <circle cx="16" cy="16" r="3" fill="currentColor" stroke="none" />
      <path d="M16 1v5M16 26v5M1 16h5M26 16h5" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * "TRUTHLENS" in condensed capitals on a solid label stuck on at -2°, like a
 * strip of label tape. Ink and paper swap with the theme (--rn-* palette).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block -rotate-2 bg-[var(--rn-ink)] px-2 py-1 font-display text-[1.2rem] leading-none text-[var(--rn-base)] shadow-[3px_3px_0_var(--rn-red)] sm:text-[1.75rem] ${className}`}
    >
      TruthLens
    </span>
  );
}
