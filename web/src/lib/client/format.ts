// Small display helpers shared by the pages.

/** 0x3fa9c2…e81d: enough to recognise a hash at a glance. */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= 2 + head + tail) return hash;
  return `${hash.slice(0, 2 + head)}…${hash.slice(-tail)}`;
}

/**
 * "29 Oct 2026, 12:05:43". A FIXED locale on purpose: pages rendered on the
 * server and then hydrated in the browser must produce identical text, and
 * the server's default locale can differ from the visitor's.
 */
export function formatChainTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export function txExplorerUrl(chainId: number, txHash: string | null): string | null {
  if (!txHash) return null;
  if (chainId === 80002) return `https://amoy.polygonscan.com/tx/${txHash}`;
  return null;
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `work`, but takes at least `minMs`, so each step of an animated
 * sequence is visible long enough to read. The REAL duration of the work is
 * returned and shown in the UI, so the animation never misrepresents speed.
 */
export async function atLeast<T>(minMs: number, work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const valuePromise = work().then((value) => ({ value, ms: Math.round(performance.now() - start) }));
  const [result] = await Promise.all([valuePromise, delay(minMs)]);
  return result;
}

/** Human-friendly messages for the API's error codes. */
export function describeError(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    CHAIN_UNREACHABLE: "The blockchain node is offline. Start it with `npm run chain`.",
    CONTRACT_NOT_DEPLOYED: "The contract isn't deployed yet. Run `npm run deploy:local`.",
    RELAYER_NOT_CONFIGURED: "The server has no relayer wallet configured (RELAYER_PRIVATE_KEY).",
    RATE_LIMITED: "Too many photos in a short time. Wait a minute and try again.",
    FILE_TOO_LARGE: "That image is too large (max 15 MB).",
    NOT_AN_IMAGE: "That file isn't an image we can read.",
    UNSUPPORTED_FORMAT: "Unsupported format. Use JPEG, PNG or WebP.",
    SIGNATURE_INVALID: "The device signature didn't match the photo.",
    HASH_MISMATCH: "The photo was altered on its way to the server.",
    ALREADY_REGISTERED: "This exact photo is already sealed on the blockchain.",
    NETWORK: "Could not reach the TruthLens server.",
  };
  return messages[code] ?? fallback;
}

/** "just now", "42s ago", "5 min ago", "3 h ago", or a date for older items. */
export function timeAgo(unixSeconds: number, nowMs = Date.now()): string {
  // The chain's clock can be a few seconds off the browser's (local Hardhat
  // especially), so clamp small negative differences to "just now".
  const s = Math.max(0, Math.round(nowMs / 1000 - unixSeconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
