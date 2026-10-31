"use client";

// Camera access with getUserMedia, plus capturing a still JPEG from the stream.
//
// Browsers only allow camera access in a "secure context": https://, or
// http://localhost. Opening the dev server from a phone at http://192.168.x.x
// therefore gets no camera. Use `npm run dev:https` for that.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type CameraStatus =
  | "starting"
  | "live"
  | "denied" // the user (or browser policy) refused permission
  | "insecure" // not https/localhost: the browser hides the camera API
  | "unavailable" // no camera device found
  | "error";

export type Facing = "environment" | "user";

const noSubscribe = () => () => {};
/** True when the browser exposes the camera API. During server rendering we assume yes. */
function useCameraApiAvailable(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia),
    () => true,
  );
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const apiAvailable = useCameraApiAvailable();
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [facing, setFacing] = useState<Facing>("environment");
  const [canSwitch, setCanSwitch] = useState(false);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump to retry

  useEffect(() => {
    if (!apiAvailable) return;

    // `cancelled` handles React running this effect twice in development and
    // the user switching cameras mid-start: a stream that arrives late is
    // stopped immediately instead of leaking.
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then(async (s) => {
        stream = s;
        if (cancelled) return s.getTracks().forEach((t) => t.stop());

        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => undefined); // autoplay is allowed: muted + playsInline
          setResolution({ width: video.videoWidth, height: video.videoHeight });
        }
        // Device count is only reliable after permission was granted.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
          setStatus("live");
        }
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        if (err.name === "NotAllowedError" || err.name === "SecurityError") setStatus("denied");
        else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") setStatus("unavailable");
        else {
          setStatus("error");
          // NotReadableError usually means another app is using the camera.
          setErrorText(err.name === "NotReadableError" ? "The camera is busy in another app." : String(err.message ?? err));
        }
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [apiAvailable, facing, attempt]);

  // State changes that restart the camera happen in these event handlers,
  // not inside the effect (React's recommended pattern).
  const switchCamera = useCallback(() => {
    setStatus("starting");
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);
  const retry = useCallback(() => {
    setStatus("starting");
    setErrorText(null);
    setAttempt((a) => a + 1);
  }, []);

  /**
   * Grabs the current frame at the camera's full resolution as a JPEG. These
   * exact bytes are what gets hashed, signed and registered.
   */
  const captureFrame = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error("Camera is not ready");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    // The front-camera PREVIEW is mirrored (like a mirror), but the saved photo
    // is not, so text in the scene reads correctly, as with a normal camera.
    ctx.drawImage(video, 0, 0);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", 0.92),
    );
  }, []);

  return {
    videoRef,
    status: apiAvailable ? status : ("insecure" as const),
    facing,
    canSwitch,
    resolution,
    errorText,
    switchCamera,
    retry,
    captureFrame,
  };
}
