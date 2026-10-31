"use client";

// Masthead, ransom-note edition: the TRUTHLENS label stuck on at an angle,
// the links as little coloured paper tabs (Space Mono), the theme toggle and
// a chunky CAPTURE button with a blinking "recording" dot. The active link's
// tab sits lifted with a red bar under it that slides between links (Framer
// Motion `layoutId`). Colours come from the --rn-* palette in globals.css,
// so it follows the theme (Midnight at night, Riso by day).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useScroll, useSpring } from "framer-motion";
import { Wordmark } from "@/components/ui/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Magnetic } from "@/components/ui/magnetic";
import { ScrambleLabel } from "@/components/ui/scramble-label";

// `wide`: only shown from the sm breakpoint up (the logo already links home).
// Each tab is a different scrap of paper, at its own slight angle.
const LINKS = [
  { href: "/", label: "Index", wide: true, paper: "#fff27a", tilt: -2 },
  { href: "/verify", label: "Verify", wide: false, paper: "#ffc1dc", tilt: 1.5 },
  { href: "/explorer", label: "Ledger", wide: false, paper: "#bfe3ff", tilt: -1 },
];

/** The nav reads the current URL to highlight the active link. */
export function SiteNav() {
  return <NavBar pathname={usePathname()} />;
}

/**
 * Same bar without the active highlight. With Cache Components the URL of a
 * dynamic route (e.g. /provenance/[sha256]) is request-time data, so the layout
 * wraps <SiteNav> in <Suspense> and shows this identical-looking fallback first.
 */
export function SiteNavFallback() {
  return <NavBar pathname={null} />;
}

function NavBar({ pathname }: { pathname: string | null }) {
  // Reading progress: a red rule along the bottom edge of the masthead.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rn-ink)]/15 bg-[var(--rn-base)]">
      <motion.div aria-hidden className="absolute inset-x-0 -bottom-px h-[3px] origin-left bg-[var(--rn-red)]" style={{ scaleX: progress }} />
      <nav className="mx-auto flex h-[72px] w-full max-w-7xl items-center gap-1.5 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="mr-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--rn-blue)]" aria-label="TruthLens home">
          <Wordmark />
        </Link>

        <div className="flex items-center gap-2 sm:mr-auto sm:gap-3">
          {LINKS.map(({ href, label, wide, paper, tilt }) => {
            const active = pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                data-active={active}
                className={`relative px-2 py-1.5 font-spacemono text-[12px] font-bold text-[#14120f] shadow-[2px_2px_0_var(--rn-shadow)] transition-transform duration-150 hover:-translate-y-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--rn-blue)] data-[active=true]:-translate-y-1 data-[active=true]:shadow-[3px_4px_0_var(--rn-shadow)] sm:px-3 sm:text-[14px] ${wide ? "hidden sm:block" : ""}`}
                style={{ background: paper, rotate: `${tilt}deg` }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-marker"
                    aria-hidden
                    className="absolute inset-x-1 -bottom-[9px] h-[4px] bg-[var(--rn-red)]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <ScrambleLabel text={label} />
              </Link>
            );
          })}
        </div>

        {/* On phones the toggle lives in the footer, to leave room for Capture. */}
        <span data-cursor="Flip" className="hidden sm:inline">
          <ThemeToggle />
        </span>

        <Magnetic strength={0.25}>
          <Link
            href="/capture"
            data-cursor="Seal"
            className="inline-flex h-10 items-center gap-1.5 border-2 border-[var(--rn-ink)] bg-[var(--rn-red)] px-2.5 font-spacemono text-[11px] font-bold uppercase tracking-[0.04em] text-white shadow-[4px_4px_0_0_var(--rn-ink)] transition-[transform,box-shadow] duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--rn-ink)] active:translate-x-1 active:translate-y-1 active:shadow-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--rn-blue)] sm:h-11 sm:gap-2.5 sm:px-5 sm:text-[14px]"
          >
            <span aria-hidden className="animate-pulse-dot size-2.5 rounded-full bg-white" />
            Capture
          </Link>
        </Magnetic>
      </nav>
    </header>
  );
}
