"use client";

// Capture page: full-screen viewfinder → shutter → hash → sign → seal on-chain.
//
// Where each step runs:
//   Hashing   in the browser: SHA-256 of the exact JPEG bytes (+ perceptual hash)
//   Signing   in the browser: ECDSA P-256 with this device's non-extractable key
//   Chain     on the server: POST /api/register, which re-checks everything,
//             stores the original and writes the record via the relayer wallet
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Camera, Download, ImageUp, RefreshCcw, ScanLine, SwitchCamera, TriangleAlert } from "lucide-react";
import { getDeviceIdentity, type DeviceIdentity } from "@/lib/crypto/device-key-store";
import { sha256Hex } from "@/lib/crypto/hash";
import { computePHash } from "@/lib/crypto/phash";
import { signImageHash } from "@/lib/crypto/signing";
import { decodeImageInBrowser } from "@/lib/image/decode-browser";
import { ApiError, registerPhoto } from "@/lib/client/api";
import { atLeast, describeError, formatChainTime, shortHash } from "@/lib/client/format";
import { handOffToVerify } from "@/lib/client/handoff";
import { useCamera, type CameraStatus } from "@/lib/client/use-camera";
import type { RegisterResponse } from "@/lib/api-types";
import { Hud, type KeyState } from "./hud";
import { SealSequence, type Step } from "./seal-sequence";
import { Stamp } from "@/components/ui/stamp";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";

const INITIAL_STEPS: Step[] = [
  { id: "hash", title: "Hashing", subtitle: "SHA-256 of the exact bytes + perceptual hash", status: "pending" },
  { id: "sign", title: "Signing", subtitle: "ECDSA P-256 with this device's private key", status: "pending" },
  { id: "chain", title: "Writing to blockchain", subtitle: "Relayer submits to the TruthRegistry contract", status: "pending" },
  { id: "sealed", title: "Sealed", subtitle: "Provenance record is permanent", status: "pending" },
];

type Phase = "viewfinder" | "sealing" | "sealed" | "failed";

export function CaptureView() {
  const router = useRouter();
  const reduce = useReducedMotion();
  // Destructured on purpose: React treats an object holding a ref as "ref-like",
  // so reading cameraStatus during render would be flagged as reading a ref.
  const { videoRef, status: cameraStatus, facing, canSwitch, resolution, errorText, switchCamera, retry, captureFrame } =
    useCamera();

  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [keyState, setKeyState] = useState<KeyState>("loading");
  const [phase, setPhase] = useState<Phase>("viewfinder");
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [flash, setFlash] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Load (or create on first visit) this device's signing key.
  useEffect(() => {
    getDeviceIdentity()
      .then((id) => {
        setIdentity(id);
        setKeyState("ready");
      })
      .catch(() => setKeyState("error"));
  }, []);

  // Free the photo's object URL when it is replaced or the page closes.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  const updateStep = (id: Step["id"], patch: Partial<Step>) =>
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function seal(blob: Blob) {
    if (!identity) return;
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setSteps(INITIAL_STEPS);
    setResult(null);
    setError(null);
    setPhase("sealing");

    const minStep = reduce ? 0 : 850; // long enough to read each step
    let current: Step["id"] = "hash";
    try {
      // 1. Hash
      updateStep("hash", { status: "active" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hashed = await atLeast(minStep, async () => ({
        sha256: await sha256Hex(bytes),
        pHash: computePHash(await decodeImageInBrowser(blob)),
      }));
      updateStep("hash", {
        status: "done",
        ms: hashed.ms,
        lines: [
          { label: "SHA-256", value: hashed.value.sha256 },
          { label: "pHash  ", value: hashed.value.pHash },
        ],
      });

      // 2. Sign
      current = "sign";
      updateStep("sign", { status: "active" });
      const signed = await atLeast(minStep, () => signImageHash(identity.privateKey, hashed.value.sha256));
      updateStep("sign", {
        status: "done",
        ms: signed.ms,
        lines: [
          { label: "sig    ", value: signed.value },
          { label: "key    ", value: identity.keyFingerprint },
        ],
      });

      // 3. Register on-chain (server verifies, stores, and writes via the relayer)
      current = "chain";
      updateStep("chain", { status: "active" });
      const registered = await atLeast(minStep, () =>
        registerPhoto({ photo: blob, publicKey: identity.publicKeyHex, signature: signed.value, sha256: hashed.value.sha256 }),
      );
      const r = registered.value;
      updateStep("chain", {
        status: "done",
        ms: registered.ms,
        lines: [
          { label: "tx     ", value: r.txHash },
          { label: "block  ", value: `#${r.record.blockNumber}` },
        ],
      });

      // 4. Sealed
      current = "sealed";
      updateStep("sealed", {
        status: "done",
        lines: [{ label: "time   ", value: formatChainTime(r.record.timestamp) }],
      });
      setResult(r);
      setPhase("sealed");
      navigator.vibrate?.([20, 60, 40]);
    } catch (err) {
      updateStep(current, { status: "error" });
      setError(err instanceof ApiError ? describeError(err.code, err.message) : (err as Error).message);
      setPhase("failed");
    }
  }

  async function shutter() {
    if (cameraStatus !== "live" || keyState !== "ready" || phase !== "viewfinder") return;
    navigator.vibrate?.(25);
    setFlash(true);
    try {
      await seal(await captureFrame());
    } catch (err) {
      setError((err as Error).message);
      setPhase("failed");
    }
  }

  function reset() {
    setPhase("viewfinder");
    setPhoto(null);
    setSteps(INITIAL_STEPS);
    setResult(null);
    setError(null);
  }

  function verifyIt() {
    if (!photo || !result) return;
    handOffToVerify(new File([photo.blob], fileName(result), { type: "image/jpeg" }));
    router.push("/verify");
  }

  const fileName = (r: RegisterResponse) => `truthlens-${r.record.sha256.slice(2, 10)}.jpg`;
  const explorer = result?.explorerUrl ?? null; // set by the server on public networks only

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-ink">
      {/* Live camera. The front camera preview is mirrored, like a mirror. */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 size-full object-cover"
        style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
      />

      {/* Frozen captured frame while sealing */}
      <AnimatePresence>
        {photo && (
          <motion.img
            key={photo.url}
            src={photo.url}
            alt="Captured photo"
            className="absolute inset-0 size-full object-cover"
            initial={{ scale: 1.04, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          />
        )}
      </AnimatePresence>

      <Hud
        keyState={keyState}
        keyFingerprint={identity?.keyFingerprint ?? null}
        resolution={resolution}
        dimmed={phase !== "viewfinder"}
      />

      {/* Sealed: a rubber stamp lands on the photo */}
      <AnimatePresence>
        {phase === "sealed" && result && (
          <div className="pointer-events-none absolute left-1/2 top-[5%] origin-top -translate-x-1/2 scale-75 sm:left-[calc(50%-210px)] sm:top-[16%] sm:scale-100">
            {/* Phones: higher and smaller, above the receipt that fills the lower screen */}
            <Stamp label="Sealed" sub={`block #${result.record.blockNumber}`} tone="authentic" size="lg" slam className="bg-paper/90" />
          </div>
        )}
      </AnimatePresence>

      {/* Shutter flash */}
      <AnimatePresence>
        {flash && (
          <motion.div
            className="pointer-events-none absolute inset-0 bg-white"
            initial={{ opacity: 0.95 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            onAnimationComplete={() => setFlash(false)}
          />
        )}
      </AnimatePresence>

      {/* Camera problems (only while in the viewfinder) */}
      {phase === "viewfinder" && cameraStatus !== "live" && cameraStatus !== "starting" && (
        <CameraProblem
          status={cameraStatus}
          detail={errorText}
          onRetry={retry}
          onPickFile={() => fileInput.current?.click()}
          canSign={keyState === "ready"}
        />
      )}
      {keyState === "error" && phase === "viewfinder" && (
        <p className="absolute inset-x-4 top-20 mx-auto max-w-md border border-fake bg-sheet p-3 text-center text-sm text-ink">
          This browser could not create a signing key (IndexedDB unavailable, e.g. a strict private mode). Photos can&apos;t be sealed.
        </p>
      )}

      {/* Controls */}
      {phase === "viewfinder" && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pt-4 sm:justify-center sm:gap-24"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
        >
          <Link href="/" aria-label="Back to home" className="grid size-12 place-items-center bg-black/55 text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
            <ArrowLeft className="size-5" />
          </Link>

          <motion.button
            type="button"
            onClick={shutter}
            disabled={cameraStatus !== "live" || keyState !== "ready"}
            whileTap={{ scale: 0.88 }}
            aria-label="Take and seal photo"
            className="group relative grid size-20 place-items-center rounded-full border-4 border-white/90 outline-none transition disabled:opacity-40 focus-visible:ring-4 focus-visible:ring-white/60"
          >
            <span className="size-[60px] rounded-full bg-white transition group-enabled:group-hover:scale-90 group-enabled:group-active:bg-[#7d95ff]" />
          </motion.button>

          <button
            type="button"
            onClick={switchCamera}
            disabled={!canSwitch}
            aria-label="Switch camera"
            className="grid size-12 place-items-center bg-black/55 text-white outline-none transition disabled:opacity-0 focus-visible:ring-2 focus-visible:ring-white"
          >
            <SwitchCamera className="size-5" />
          </button>
        </div>
      )}

      {/* Sealing / sealed / failed panel */}
      {phase !== "viewfinder" && (
        <SealSequence
          steps={steps}
          barcode={result?.record.sha256 ?? null}
          footer={
            phase === "sealing" ? null : phase === "failed" ? (
              <div className="space-y-3">
                <p className="flex gap-2 border border-fake p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-fake" />
                  {error}
                </p>
                <ActionButton onClick={reset} icon={<RefreshCcw className="size-4" />} primary>
                  Try again
                </ActionButton>
              </div>
            ) : (
              result && (
                <div className="space-y-3">
                  <p className="text-xs text-muted">
                    Sealed by key <span className="font-mono text-ink">{shortHash(result.record.signerKeyHash)}</span>. Download the
                    file to share or edit it. Any change will show up when it is verified.
                    <Link href={`/provenance/${result.record.sha256}`} className="ml-1 text-signal underline">
                      Timeline
                    </Link>
                    {explorer && (
                      <a href={explorer} target="_blank" rel="noreferrer" className="ml-2 text-signal underline">
                        Polygonscan
                      </a>
                    )}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <a
                      href={photo?.url}
                      download={fileName(result)}
                      className="flex flex-col items-center gap-1 border border-ink px-2 py-2.5 text-xs font-semibold transition hover:bg-ink hover:text-paper outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      <Download className="size-4" /> Download
                    </a>
                    <ActionButton onClick={verifyIt} icon={<ScanLine className="size-4" />} primary>
                      Verify it
                    </ActionButton>
                    <ActionButton onClick={reset} icon={<Camera className="size-4" />}>
                      New photo
                    </ActionButton>
                  </div>
                </div>
              )
            )
          }
        />
      )}

      {/* Fallback: sign a photo file (on phones this opens the camera app). */}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void seal(file);
        }}
      />
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-center justify-center gap-1 px-2 py-2.5 text-xs font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-signal ${
        primary
          ? "bg-ink text-paper hover:bg-signal hover:text-signal-ink"
          : "border border-ink text-ink hover:bg-ink hover:text-paper"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function CameraProblem({
  status,
  detail,
  onRetry,
  onPickFile,
  canSign,
}: {
  status: CameraStatus;
  detail: string | null;
  onRetry: () => void;
  onPickFile: () => void;
  canSign: boolean;
}) {
  const copy: Record<string, { title: string; body: string }> = {
    insecure: {
      title: "Camera needs a secure connection",
      body: "Browsers only allow the camera on https:// or localhost. On a phone, start the dev server with `npm run dev:https` and open the https:// address.",
    },
    denied: {
      title: "Camera permission blocked",
      body: "Allow camera access for this site in your browser settings, then retry.",
    },
    unavailable: { title: "No camera found", body: "This device doesn't seem to have a camera." },
    error: { title: "Camera failed to start", body: detail ?? "Something went wrong opening the camera." },
  };
  const { title, body } = copy[status] ?? copy.error;

  return (
    <div className="absolute inset-0 grid place-items-center bg-black/75 p-4">
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm border border-ink bg-sheet text-ink"
        role="alert"
      >
        <div className="flex items-center justify-between border-b border-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-edited">
          <span>Camera</span>
          <TriangleAlert className="size-4" />
        </div>
        <div className="p-5">
          <h2 className="font-display text-3xl leading-tight">{title}</h2>
          <p className="mt-2 text-sm text-muted">{body}</p>
          <div className="mt-5 grid gap-2">
            {status !== "insecure" && status !== "unavailable" && (
              <button onClick={onRetry} className={btnPrimary}>
                Retry camera
              </button>
            )}
            <button onClick={onPickFile} disabled={!canSign} className={btnSecondary}>
              <ImageUp className="size-4" /> Sign a photo file instead
            </button>
            <p className="text-[11px] leading-4 text-muted">
              A file&apos;s provenance starts when you sign it. TruthLens can&apos;t vouch for what happened to it before.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
