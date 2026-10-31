"use client";

// Landing sections below the hero, set like a case file: numbered sections
// (§), condensed headlines, the method as index cards pinned to the board.
// Each block rises in when it scrolls into view.
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Camera } from "lucide-react";
import { Stamp } from "@/components/ui/stamp";
import { btnPrimary, btnSecondary, label } from "@/components/ui/styles";
import { ThemeToggle } from "@/components/theme-toggle";
import { Magnetic } from "@/components/ui/magnetic";

const inView = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
};

function SectionHead({ n, title, aside }: { n: string; title: React.ReactNode; aside?: string }) {
  return (
    <motion.div {...inView} className="mb-10 grid gap-4 border-t border-ink pt-4 md:grid-cols-12">
      <p className={`md:col-span-2 ${label}`}>§ {n}</p>
      <h2 className="font-display text-5xl leading-[0.92] md:col-span-6 md:text-7xl">{title}</h2>
      {aside && <p className="self-end text-muted md:col-span-4">{aside}</p>}
    </motion.div>
  );
}

const STEPS = [
  { title: "Capture", tech: "getUserMedia · JPEG", body: "The photo is taken inside the TruthLens camera, so there's no moment where it could be swapped." },
  { title: "Fingerprint", tech: "SHA-256 · 64-bit pHash", body: "SHA-256 locks in the exact bytes. A perceptual hash remembers what the picture looks like." },
  { title: "Sign", tech: "ECDSA P-256 · non-extractable", body: "A key that can never leave this device signs the fingerprint. Nobody else can forge it." },
  { title: "Anchor", tech: "TruthRegistry · EVM", body: "The fingerprint is written to a smart contract, timestamped by the chain itself. Permanently." },
];

const CARD_TILT = [-2.5, 1.5, -1, 2.5];

export function HowItWorks() {
  return (
    <section id="method" className="mx-auto w-full max-w-7xl scroll-mt-24 pt-24">
      <SectionHead n="01 — Method" title={<>Sealed in the second it&apos;s <em>taken.</em></>} aside="Four steps between the shutter and the ledger. The first three never leave your device." />
      {/* Index cards, each pinned at a slight angle; hovering straightens and lifts one. */}
      <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            initial={{ opacity: 0, y: 40, rotate: 0 }}
            whileInView={{ opacity: 1, y: 0, rotate: CARD_TILT[i] }}
            whileHover={{ rotate: 0, y: -8, scale: 1.02 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.1 * i }}
            className="relative border border-rule bg-sheet p-6 pt-8 shadow-[6px_8px_0_0_rgb(0_0_0/0.28)]"
          >
            <span aria-hidden className="absolute left-1/2 top-3 size-3.5 -translate-x-1/2 rounded-full bg-alarm shadow-[1px_2px_2px_rgb(0_0_0/0.4)]" />
            <p className="font-display text-7xl leading-none text-hot">{String(i + 1).padStart(2, "0")}</p>
            <h3 className="mt-5 font-display text-4xl">{s.title}</h3>
            <p className="mt-1 font-mono text-[12px] font-semibold text-signal">{s.tech}</p>
            <p className="mt-3 text-muted">{s.body}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

export function Verdicts() {
  const items = [
    { stamp: "Authentic", tone: "authentic" as const, rotate: -6, body: "Exact SHA-256 match with a sealed record and a valid device signature. Not one bit changed." },
    { stamp: "Edited", tone: "edited" as const, rotate: 4, body: "Looks like a sealed original, but the bytes differ. Hatching shows which regions changed, and by how much." },
    { stamp: "Unverified", tone: "fake" as const, rotate: -3, body: "No provenance record. Its origin can't be proven, which is not the same as proven fake." },
  ];
  return (
    <section className="mx-auto w-full max-w-7xl pt-24">
      <SectionHead n="02 — Verdicts" title={<>Three possible <em>findings.</em></>} aside="Anyone can verify any image. No account, no wallet, no fee: verification only reads the ledger." />
      <div className="grid gap-px border border-ink bg-rule md:grid-cols-3">
        {items.map((it, i) => (
          <motion.div key={it.stamp} {...inView} transition={{ ...inView.transition, delay: 0.1 * i }} className="bg-paper p-8">
            <div className="grid h-32 place-items-center">
              <Stamp label={it.stamp} tone={it.tone} rotate={it.rotate} slam="view" delay={0.15 * i} />
            </div>
            <p className="mt-6 text-muted">{it.body}</p>
          </motion.div>
        ))}
      </div>
      <motion.div {...inView} className="mt-6">
        <Link href="/verify" className="group inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-signal">
          Examine an image <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </motion.div>
    </section>
  );
}

export function HonestScope() {
  const proves = [
    "This exact file was signed by one specific device, no later than the block it was sealed in.",
    "Whether a copy was re-encoded, filtered or locally edited, and which regions changed.",
    "The full chain of registered edits, from the original capture onwards.",
  ];
  const doesNot = [
    "Detect AI-generated images by analysing their pixels. There is no deepfake classifier here.",
    "Prove the scene itself was real, for example someone photographing a screen.",
    "Vouch for photos never captured with TruthLens. Those are simply “unverified”.",
  ];
  const roman = ["i", "ii", "iii"];
  return (
    <section className="mx-auto w-full max-w-7xl pt-24">
      <SectionHead n="03 — Scope" title={<>Provenance, not <em>prophecy.</em></>} aside="Detectors guess and can be fooled. A cryptographic seal either matches or it doesn't, and that certainty has clear limits." />
      <div className="grid gap-12 md:grid-cols-2">
        {[
          { head: "TruthLens proves", mark: "✓", tone: "text-authentic", list: proves },
          { head: "It does not", mark: "✕", tone: "text-fake", list: doesNot },
        ].map((col) => (
          <motion.div key={col.head} {...inView}>
            <p className={`border-b border-ink pb-3 font-display text-3xl ${col.tone}`}>{col.head}</p>
            <ol>
              {col.list.map((t, i) => (
                <li key={t} className="grid grid-cols-[2.5rem_1.5rem_1fr] gap-2 border-b border-rule py-4">
                  <span className="font-mono text-muted">({roman[i]})</span>
                  <span className={`font-display text-xl leading-6 ${col.tone}`}>{col.mark}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-7xl pt-28">
      <motion.div {...inView} className="border-t border-ink pt-10">
        <h2 className="font-display text-[clamp(3.4rem,9vw,8.5rem)] leading-[0.88]">
          Give your next photo <em>an alibi.</em>
        </h2>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Take a photo, edit it anywhere, then verify both. Watch the seal hold, and the edit get caught.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Magnetic>
            <Link href="/capture" className={btnPrimary} data-cursor="Seal">
              <Camera className="size-4" /> Open the camera
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/explorer" className={btnSecondary} data-cursor="Read">
              Read the ledger <ArrowRight className="size-4" />
            </Link>
          </Magnetic>
        </div>
      </motion.div>

      {/* Colophon */}
      <footer className={`mt-24 grid gap-4 border-t border-ink pt-4 md:grid-cols-12 ${label}`}>
        <p className="md:col-span-4">TruthLens · a seminar project</p>
        <p className="normal-case tracking-normal md:col-span-6">
          Set in Anton, Courier Prime &amp; IBM Plex Mono. Proves provenance, not the truth of content.
        </p>
        <div className="flex items-center gap-3 md:col-span-2 md:justify-end">
          Theme <ThemeToggle />
        </div>
      </footer>
    </section>
  );
}
