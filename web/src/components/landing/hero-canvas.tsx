"use client";

// Loads the 3D eye only in the browser, and only if WebGL works.
//
// three.js needs `window`, so the scene is imported with ssr: false. It is also
// a large bundle, so the page text renders first and the figure fades in after.
// No WebGL (old device, disabled GPU) → a static printed placeholder.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BrandMark } from "@/components/ui/brand";
import type { EyeVariant } from "./eye-scene";

const EyeScene = dynamic(() => import("./eye-scene"), { ssr: false, loading: () => null });

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

let webglCache: boolean | null = null;
const noSubscribe = () => () => {};

export function HeroCanvas({ variant = "original" }: { variant?: EyeVariant }) {
  const reduce = useReducedMotion();
  // undefined during server render; true/false once in the browser.
  const webgl = useSyncExternalStore(
    noSubscribe,
    () => (webglCache ??= detectWebGL()),
    () => undefined,
  );

  return (
    <motion.div
      aria-hidden
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, delay: 0.3 }}
    >
      {webgl ? (
        <EyeScene animate={!reduce} variant={variant} />
      ) : webgl === false ? (
        <div className="grid size-full place-items-center text-ink opacity-80">
          <BrandMark className="size-1/2" />
        </div>
      ) : null}
    </motion.div>
  );
}
