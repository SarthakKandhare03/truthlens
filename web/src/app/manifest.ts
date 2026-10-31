// Web app manifest: lets phones install TruthLens to the home screen, where it
// opens straight into the full-screen camera like a native app.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TruthLens: Photo Provenance",
    short_name: "TruthLens",
    description: "Capture photos sealed with cryptography and a blockchain. Verify any image's origin.",
    start_url: "/capture",
    display: "standalone",
    orientation: "portrait",
    background_color: "#13110e",
    theme_color: "#13110e", // the installed app opens straight into the (dark) camera
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
