// Printer's crop marks around an image or panel: four L-shaped ticks just
// outside the corners, the way prints are marked for trimming.
import type { ReactNode } from "react";

const corner = "pointer-events-none absolute size-3 border-ink/70";

export function CropFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <span aria-hidden className={`${corner} -left-2.5 -top-2.5 border-r border-b`} />
      <span aria-hidden className={`${corner} -right-2.5 -top-2.5 border-b border-l`} />
      <span aria-hidden className={`${corner} -bottom-2.5 -left-2.5 border-r border-t`} />
      <span aria-hidden className={`${corner} -bottom-2.5 -right-2.5 border-l border-t`} />
      {children}
    </div>
  );
}
