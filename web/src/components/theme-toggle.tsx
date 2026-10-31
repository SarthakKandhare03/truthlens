"use client";

// Night shift ⇄ day shift switch. The new theme wipes in as a circle from this button.
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "@/lib/client/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTheme(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      aria-label={theme ? `Switch to ${next === "dark" ? "night shift (dark)" : "day shift (light)"}` : "Toggle theme"}
      title={theme ? `Switch to ${next} theme` : "Toggle theme"}
      className={`relative grid size-9 place-items-center overflow-hidden border-[1.5px] border-rule text-ink transition-colors hover:border-ink outline-none focus-visible:ring-2 focus-visible:ring-signal ${className}`}
    >
      {/* Unknown during server render: show nothing rather than the wrong icon. */}
      <AnimatePresence mode="wait" initial={false}>
        {theme && (
          <motion.span
            key={theme}
            initial={{ y: 14, rotate: -90, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -14, rotate: 90, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
