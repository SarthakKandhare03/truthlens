// Keeps the variant fingerprints (mirror, rotations, crops) of every sealed
// photo up to date in the index. They are computed from the STORED original,
// so they cost nothing on-chain and are rebuilt automatically after the cache
// is reset. Runs before each verification (cheap when nothing is missing) and
// in the background right after a registration.
import "server-only";
import { computeVariants } from "../image/derivative";
import { getIndex } from "./image-index";
import { readFromStorage } from "./storage";

let filling: Promise<void> | null = null;

/** Computes any missing variant fingerprints. Concurrent callers share one run. */
export function ensureVariants(): Promise<void> {
  filling ??= fill().finally(() => {
    filling = null;
  });
  return filling;
}

async function fill(): Promise<void> {
  const index = getIndex();
  for (const { sha256, storageURI } of index.missingVariants()) {
    const bytes = await readFromStorage(storageURI).catch(() => null);
    // A record whose original is gone (e.g. the contract smoke test) is marked
    // done with no variants: it can still be matched by its plain hash.
    const variants = bytes ? await computeVariants(bytes).catch(() => []) : [];
    index.setVariants(sha256, variants);
  }
}
