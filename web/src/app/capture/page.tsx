// /capture: full-screen camera. Lives outside the (site) group so there is
// no navigation bar; the viewfinder owns the whole screen, like a native camera.
import type { Metadata } from "next";
import { CaptureView } from "@/components/capture/capture-view";

export const metadata: Metadata = { title: "Capture · TruthLens" };

export default function CapturePage() {
  return <CaptureView />;
}
