"use client";

// Light/dark theme: stored in localStorage, applied as <html data-theme="…">.
//
// The very first paint is handled by THEME_INIT_SCRIPT (lib/theme-script.ts,
// inlined in the root layout's <head>), which runs before React and before
// the page is drawn, so there is never a flash of the wrong theme. Until the
// visitor picks one with the toggle, the site opens in dark ("night shift").
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "../theme-script";

export type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Re-render whenever <html data-theme> changes (toggle, other tabs, etc.). */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The active theme, or null during server rendering (unknown until the browser runs). */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, currentTheme, () => null);
}

/**
 * Switches theme. With the View Transitions API the new theme is revealed as a
 * circle growing out of (x, y), usually the toggle button; without it (or with
 * reduced motion) it switches instantly.
 */
export function setTheme(theme: Theme, origin?: { x: number; y: number }) {
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage blocked (private mode): the theme still applies for this page
    }
  };

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reduce) {
    apply();
    return;
  }
  if (origin) {
    document.documentElement.style.setProperty("--wipe-x", `${origin.x}px`);
    document.documentElement.style.setProperty("--wipe-y", `${origin.y}px`);
  }
  doc.startViewTransition(apply);
}
