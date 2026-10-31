"use client";

// A viewfinder cursor: a precise dot plus a trailing ring with crosshair ticks.
//
//   over a link/button             the ring grows
//   over [data-cursor="Seal"] etc. the ring expands and prints that word inside
//   over [data-cursor="hide"]      the ring hides (e.g. where the loupe takes over)
//   mouse button down              the ring tightens, like focusing
//
// Drawn in "difference" blend mode, so it inverts whatever is underneath and
// stays visible on paper, on black and over photos. Only enabled for precise
// pointers (mouse/trackpad) and when the OS doesn't ask for reduced motion;
// otherwise the normal system cursor is left alone.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";

type Mode = { kind: "idle" } | { kind: "link" } | { kind: "label"; text: string } | { kind: "hide" };

export function Cursor() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  // The ring trails the dot on a spring; the dot follows exactly.
  const ringX = useSpring(x, { stiffness: 520, damping: 40, mass: 0.6 });
  const ringY = useSpring(y, { stiffness: 520, damping: 40, mass: 0.6 });

  // Turn on only for fine pointers without reduced motion; follow changes.
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const update = () => setEnabled(fine.matches && !reduce);
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, [reduce]);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add("custom-cursor");

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x.set(e.clientX);
      y.set(e.clientY);
      setVisible(true);
    };
    const onOver = (e: PointerEvent) => {
      const el = e.target as Element | null;
      const tagged = el?.closest<HTMLElement>("[data-cursor]");
      if (tagged) {
        const text = tagged.dataset.cursor ?? "";
        setMode(text === "hide" ? { kind: "hide" } : { kind: "label", text });
      } else if (el?.closest("input, textarea")) {
        setMode({ kind: "hide" });
      } else if (el?.closest("a, button, [role='button'], label, summary")) {
        setMode({ kind: "link" });
      } else {
        setMode({ kind: "idle" });
      }
    };
    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);
    const onLeave = () => setVisible(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerover", onOver);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      document.documentElement.classList.remove("custom-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;

  const size = mode.kind === "link" ? 54 : 34;
  const ringScale = pressed ? 0.75 : 1;

  return (
    <>
      {/* Ring + dot: drawn in "difference" mode so they invert whatever is underneath */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] mix-blend-difference">
        <motion.div
          className="absolute left-0 top-0"
          style={{ x: ringX, y: ringY }}
          animate={{ opacity: visible && mode.kind !== "hide" && mode.kind !== "label" ? 1 : 0 }}
        >
          <motion.div
            className="relative -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white"
            animate={{ width: size, height: size, scale: ringScale }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
          >
            {[
              "left-1/2 -top-2 h-2 w-[1.5px] -translate-x-1/2", // top tick
              "left-1/2 -bottom-2 h-2 w-[1.5px] -translate-x-1/2", // bottom tick
              "top-1/2 -left-2 h-[1.5px] w-2 -translate-y-1/2", // left tick
              "top-1/2 -right-2 h-[1.5px] w-2 -translate-y-1/2", // right tick
            ].map((c) => (
              <span key={c} className={`absolute bg-white ${c}`} />
            ))}
          </motion.div>
        </motion.div>
        <motion.div
          className="absolute left-0 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ x, y }}
          animate={{ opacity: visible && mode.kind !== "label" ? 1 : 0 }}
        />
      </div>

      {/* Label bubble: a solid caution-yellow disc with black type, NOT
          blended, so the word stays readable over any colour (e.g. a red button). */}
      <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100]" style={{ x: ringX, y: ringY }}>
        <AnimatePresence>
          {visible && mode.kind === "label" && (
            <motion.span
              key={mode.text}
              initial={{ opacity: 0, scale: 0.3, rotate: -40 }}
              animate={{ opacity: 1, scale: pressed ? 0.85 : 1, rotate: -10 }}
              exit={{ opacity: 0, scale: 0.3, rotate: 20 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              className="absolute grid size-[76px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-tape font-display text-[17px] uppercase tracking-[0.04em] text-tape-ink shadow-[0_8px_24px_rgb(0_0_0/0.35)]"
            >
              {mode.text}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
