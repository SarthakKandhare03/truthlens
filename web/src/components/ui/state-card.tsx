// Shared card for empty, error and "not found" states, so every failure in the
// app looks deliberate and tells the user what to do next. Styled like a
// filing card: ink border, a ruled header line, a big serif title.
import type { ReactNode } from "react";
import { btnPrimary, btnSecondary } from "./styles";

type Tone = "neutral" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "text-muted",
  warning: "text-edited",
  danger: "text-fake",
};

export function StateCard({
  icon,
  eyebrow,
  title,
  children,
  actions,
  tone = "neutral",
}: {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className="mx-auto w-full max-w-lg border border-ink bg-sheet">
      <div className={`flex items-center justify-between border-b border-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] ${TONES[tone]}`}>
        <span>{eyebrow ?? "Notice"}</span>
        <span className="[&>svg]:size-4">{icon}</span>
      </div>
      <div className="p-6">
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        {children && <div className="mt-3 text-muted">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export const primaryAction = btnPrimary;
export const secondaryAction = btnSecondary;
