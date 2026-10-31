"use client";

// A viewfinder cursor: a precise dot plus a trailing ring with crosshair ticks.
//
//   over a link/button             the ring grows
//   over [data-cursor="Seal"] etc. the ring hides and a sticker prints that word
//   over [data-cursor="hide"]      ring and dot hide (only where something else
//                                  shows the pointer, e.g. the Verify loupe)
//   mouse button down              the ring tightens, like focusing
//
// Drawn in "difference" blend mode, so it inverts whatever is underneath and
// stays visible on paper, on black and over photos. Only enabled for precise
// pointers (mouse/trackpad) and when the OS doesn't ask for reduced motion;
// otherwise the normal system cursor is left alone.
//
// Smoothness rules (each one fixes a visible glitch):
//   - Position goes through motion values only: no React render per mouse move.
//   - Only transform/opacity animate, and the blend mode sits on the two small
//     shapes, not on a full-screen layer (that forced the browser to re-blend
//     the whole page every frame, which stuttered over the 3D eyes and video).
//   - Mode changes are compared before setting state, and LEAVING a target is
//     delayed a moment, so crossing the tiny gaps between letters, tabs or
//     magnetic buttons doesn't make the label sticker flicker in and out.
//   - The element under the pointer is re-checked after scrolling, dragging and
//     clicks (page changes), so a stale "DRAG" sticker never hangs around.
//   - The ring jumps (no spring) when the pointer re-enters the window, instead
//     of flying in from the corner.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";

type Mode = { kind: "idle" } | { kind: "link" } | { kind: "label"; text: string } | { kind: "hide" };

const RING = 54; // px, the size over links; idle is drawn smaller with scale
const IDLE_SCALE = 34 / RING;
const LEAVE_DELAY_MS = 90; // grace period before a target's mode is dropped

const keyOf = (m: Mode) => (m.kind === "label" ? `label:${m.text}` : m.kind);

/** What the cursor should look like over `el`. */
function modeFor(el: Element | null): Mode {
  const tagged = el?.closest<HTMLElement>("[data-cursor]");
  if (tagged) {
    const text = tagged.dataset.cursor ?? "";
    return text === "hide" ? { kind: "hide" } : { kind: "label", text };
  }
  if (el?.closest("input, textarea, select, [contenteditable='true']")) return { kind: "hide" };
  if (el?.closest("a, button, [role='button'], [role='tab'], label, summary")) return { kind: "link" };
  return { kind: "idle" };
}

export function Cursor() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  // The ring trails the dot on a spring; the dot follows exactly.
  const ringX = useSpring(x, { stiffness: 560, damping: 42, mass: 0.5 });
  const ringY = useSpring(y, { stiffness: 560, damping: 42, mass: 0.5 });

  // Latest values for the event handlers (they must not re-subscribe on every change).
  const current = useRef({ mode: "idle", visible: false });
  const leaveTimer = useRef(0);

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
    let recheckFrame = 0;

    const apply = (next: Mode) => {
      const key = keyOf(next);
      if (key === current.current.mode) {
        clearTimeout(leaveTimer.current);
        return;
      }
      clearTimeout(leaveTimer.current);
      const commit = () => {
        current.current.mode = key;
        setMode(next);
      };
      // Entering a target is instant; dropping back to idle waits a beat, so a
      // 2-px gap between two targets doesn't flash the sticker off and on.
      if (next.kind === "idle") leaveTimer.current = window.setTimeout(commit, LEAVE_DELAY_MS);
      else commit();
    };

    const show = (cx: number, cy: number) => {
      if (current.current.visible) return;
      current.current.visible = true;
      ringX.jump(cx);
      ringY.jump(cy);
      setVisible(true);
    };
    const hide = () => {
      current.current.visible = false;
      setVisible(false);
      setPressed(false);
    };

    // Re-reads the element under the (still) pointer, at most once per frame.
    const recheck = () => {
      if (recheckFrame || !current.current.visible) return;
      recheckFrame = requestAnimationFrame(() => {
        recheckFrame = 0;
        apply(modeFor(document.elementFromPoint(x.get(), y.get())));
      });
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x.set(e.clientX);
      y.set(e.clientY);
      show(e.clientX, e.clientY);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      apply(modeFor(e.target as Element | null));
    };
    const onDown = (e: PointerEvent) => e.pointerType === "mouse" && setPressed(true);
    const onUp = () => {
      setPressed(false);
      recheck(); // a drag may have ended over something else
    };
    const onLeave = () => hide();

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("scroll", recheck, { passive: true, capture: true }); // also inner scrollers
    window.addEventListener("blur", hide);
    document.addEventListener("mouseleave", onLeave);
    // Pages swap under a still pointer (navigation, a verdict appearing): a
    // cheap re-check a few times a second keeps the sticker honest.
    const interval = window.setInterval(recheck, 300);

    return () => {
      document.documentElement.classList.remove("custom-cursor");
      clearTimeout(leaveTimer.current);
      clearInterval(interval);
      cancelAnimationFrame(recheckFrame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", recheck, { capture: true });
      window.removeEventListener("blur", hide);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled, x, y, ringX, ringY]);

  if (!enabled) return null;

  const ringScale = (mode.kind === "link" ? 1 : IDLE_SCALE) * (pressed ? 0.78 : 1);
  const ringOn = visible && mode.kind !== "hide" && mode.kind !== "label";
  const dotOn = visible && mode.kind !== "hide" && mode.kind !== "label";

  return (
    <>
      {/* Ring: blended on its own (small) layer, so it inverts whatever is underneath */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] mix-blend-difference will-change-transform"
        style={{ x: ringX, y: ringY }}
        initial={false}
        animate={{ opacity: ringOn ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <motion.div
          className="relative -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white"
          style={{ width: RING, height: RING }}
          initial={false}
          animate={{ scale: ringScale }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
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

      {/* Dot: follows the pointer exactly */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] mix-blend-difference will-change-transform"
        style={{ x, y }}
        initial={false}
        animate={{ opacity: dotOn ? 1 : 0 }}
        transition={{ duration: 0.1 }}
      >
        <div className="size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </motion.div>

      {/* Label sticker: a solid caution-yellow disc with black type, NOT
          blended, so the word stays readable over any colour (e.g. a red button). */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] will-change-transform"
        style={{ x: ringX, y: ringY }}
      >
        <AnimatePresence>
          {visible && mode.kind === "label" && (
            <motion.span
              key={mode.text}
              initial={{ opacity: 0, scale: 0.3, rotate: -40 }}
              animate={{ opacity: 1, scale: pressed ? 0.85 : 1, rotate: -10 }}
              exit={{ opacity: 0, scale: 0.3, rotate: 20, transition: { duration: 0.12 } }}
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
