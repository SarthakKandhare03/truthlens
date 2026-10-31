// All server configuration, read from environment variables (.env.local).
// Nothing secret has a default. Values are read lazily, so a missing relayer
// key only breaks the routes that actually need it (register), not verification.
import "server-only";
import path from "node:path";
import { ServiceError } from "./errors";

/** The well-known Hardhat test account #0. Public knowledge, so it must NEVER hold real funds. */
const HARDHAT_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const env = (name: string) => process.env[name]?.trim() || undefined;

export const config = {
  /** Which deployments/<network>.json to use: "localhost" or "amoy". */
  get chainNetwork() {
    return env("CHAIN_NETWORK") ?? "localhost";
  },
  get rpcUrl() {
    return env("RPC_URL") ?? "http://127.0.0.1:8545";
  },

  /** Private key of the relayer wallet that pays gas for registrations. */
  relayerPrivateKey(chainId: number): string {
    const key = env("RELAYER_PRIVATE_KEY");
    if (!key) {
      throw new ServiceError(503, "RELAYER_NOT_CONFIGURED", "RELAYER_PRIVATE_KEY is not set in web/.env.local");
    }
    // Safety net: the public Hardhat key is fine on the local chain (31337) but
    // must never be used on a real network, where anyone could drain it.
    if (key.toLowerCase().includes(HARDHAT_TEST_KEY.slice(2)) && chainId !== 31337) {
      throw new ServiceError(503, "UNSAFE_RELAYER_KEY", "Refusing to use the public Hardhat test key on a non-local chain");
    }
    return key;
  },

  get storageDriver(): "local" | "s3" {
    return env("STORAGE_DRIVER") === "s3" ? "s3" : "local";
  },
  // turbopackIgnore: these folders hold RUNTIME data (uploads, the SQLite
  // cache). Without the comment, the build cannot know where they point, so
  // it traces and bundles the whole project into the server output.
  get storageLocalDir() {
    return path.resolve(/*turbopackIgnore: true*/ env("STORAGE_LOCAL_DIR") ?? path.join(process.cwd(), "storage"));
  },
  get s3() {
    return {
      bucket: env("S3_BUCKET"),
      region: env("AWS_REGION") ?? "us-east-1",
      // Optional: S3-compatible services (MinIO, Cloudflare R2) need a custom endpoint.
      endpoint: env("S3_ENDPOINT"),
    };
  },

  /** SQLite search index, one file per network so local and Amoy never mix. */
  get databasePath() {
    return path.resolve(
      /*turbopackIgnore: true*/ env("DATABASE_PATH") ?? path.join(process.cwd(), "data", `index-${this.chainNetwork}.db`),
    );
  },

  get maxUploadBytes() {
    return Number(env("MAX_UPLOAD_MB") ?? 15) * 1024 * 1024;
  },
  /** Registrations cost the relayer gas, so each IP gets a limited number per minute. */
  get registerRateLimitPerMinute() {
    return Number(env("REGISTER_RATE_LIMIT_PER_MINUTE") ?? 10);
  },
};
