import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * This computer's LAN IPv4 addresses (e.g. 192.168.1.23). The Next.js dev
 * server blocks dev assets requested from other hostnames, so without these
 * a phone opening https://192.168.1.23:3000 to test the camera page would
 * load a broken page. Development only; production builds ignore this option.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // LAN IPs for phone testing, plus Cloudflare quick tunnels (`npx untun tunnel`)
  // as a real-HTTPS alternative.
  allowedDevOrigins: [...lanAddresses(), "*.trycloudflare.com"],
  experimental: {
    // Turbopack's on-disk dev cache (.next/dev/cache) speeds up restarts, but a
    // dev server killed mid-write (or OneDrive syncing those files while they
    // are written) can leave it half-written, which we saw as an endless page
    // reload loop. Reliability matters more than startup time for a live demo.
    // If pages ever reload in a loop anyway: stop the server, `npm run clean`.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
