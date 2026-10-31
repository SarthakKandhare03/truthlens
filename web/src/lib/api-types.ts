// Shapes of the JSON returned by the API routes. Shared by the server (which
// produces them) and the React pages (which render them), so a change on one
// side is a type error on the other.
import type { ProofCheck } from "./crypto/proof";

/** A TruthRegistry record, converted to plain JSON-friendly values. */
export type ChainRecord = {
  sha256: string;
  pHash: string; // 0x + 16 hex
  signerKeyHash: string;
  storageURI: string;
  registrar: string; // relayer address that submitted it
  timestamp: number; // unix seconds, set by the chain
  blockNumber: number;
  index: number; // position in the global registration order
  parentHash: string | null; // original this was edited from
  txHash: string | null; // registration transaction (when known)
};

export type RegisterResponse = {
  record: ChainRecord;
  txHash: string;
  editTxHash: string | null; // set when a parentHash was linked
  editLinkError: string | null; // image registered, but linking it to the parent failed
  explorerUrl: string | null; // block explorer link on public networks
  /** Milliseconds per server step, which the capture animation can replay. */
  timings: { verifySignature: number; perceptualHash: number; storage: number; blockchain: number };
};

export type DiffSummary = {
  gridSize: number;
  grid: number[]; // gridSize² values, 0–1 = share of the cell that changed
  changedPercent: number;
  changedCells: number;
  globalAdjustment: boolean;
  alignment: "exact" | "resized" | "approximate";
  /**
   * Set when the copy is cropped, mirrored and/or rotated relative to the
   * original: where it came from (rect, fractions of the original after
   * rotation/mirroring) and how it was turned. null for a plain copy.
   */
  geometry?: {
    rect: { x: number; y: number; w: number; h: number };
    rotation: 0 | 90 | 180 | 270;
    mirrored: boolean;
    cropped: boolean;
    keptPercent: number;
  } | null;
};

export type VerifyResponse =
  | {
      verdict: "AUTHENTIC";
      sha256: string;
      record: ChainRecord;
      checks: ProofCheck; // every sub-check passed
      signer: { publicKey: string; keyHash: string };
      network: NetworkInfo;
    }
  | {
      verdict: "EDITED";
      sha256: string;
      pHash: string;
      original: ChainRecord;
      originalUrl: string; // for the before/after slider
      originalChecks: ProofCheck; // the ORIGINAL is genuinely signed
      distance: number; // pHash Hamming distance (0–64)
      similarity: number; // %
      diff: DiffSummary;
      /** "reencoded": no visible change (e.g. sent via WhatsApp);
       *  "adjusted": only a global filter; "modified": local regions changed. */
      editKind: "reencoded" | "adjusted" | "modified";
      network: NetworkInfo;
    }
  | {
      verdict: "UNVERIFIED";
      sha256: string;
      pHash: string | null;
      /** Why no provenance could be established. */
      reason: "NO_RECORD" | "SIGNATURE_INVALID" | "PROOF_MISSING" | "NOT_A_DERIVATIVE";
      nearestDistance: number | null; // closest registered pHash, for transparency
      network: NetworkInfo;
    };

/** POST /api/match (live verify): the closest sealed photo to one camera frame. */
export type MatchResponse = {
  best: { sha256: string; distance: number } | null;
  record: ChainRecord | null; // only when best.distance is within LIVE_MATCH
};

export type NetworkInfo = { name: string; chainId: number; contract: string };

export type ProvenanceNode = ChainRecord & { depth: number; children: string[] };
export type ProvenanceResponse = { root: string; focus: string; nodes: ProvenanceNode[]; network: NetworkInfo };

export type FeedItem = ChainRecord;
export type StatsResponse = {
  totalRecords: number; // images secured
  latestBlock: number; // blocks written
  editsTracked: number; // registered edits linked to an original
  network: NetworkInfo;
};

export type ApiError = { error: { code: string; message: string; details?: unknown } };
