// Shared class strings, so buttons and labels look the same everywhere.
// Square corners and typewriter type. On hover a button lifts off the board
// and casts a hard caution-yellow shadow (a "print" offset, not a glow).

const base =
  "inline-flex items-center justify-center gap-2 px-6 py-3.5 font-sans text-[15px] font-bold transition-[transform,box-shadow,background-color,color] duration-150 outline-none hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--tape)] active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40";

/** Evidence-red block: the main action on a page. */
export const btnPrimary = `${base} bg-alarm text-alarm-ink`;

/** Ink outline; fills with ink on hover. */
export const btnSecondary = `${base} border-[1.5px] border-ink text-ink hover:bg-ink hover:text-paper`;

/** Small mono-caps label, e.g. section numbers and table headers. */
export const label = "font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-muted";
