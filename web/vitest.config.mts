// Unit tests run in plain Node (`npm test`). Node 20+ ships the same Web Crypto
// API as browsers, so the hashing and signing code is tested exactly as it runs
// on the capture page. IndexedDB is provided by fake-indexeddb in the tests that
// need it.
import { defineConfig } from "vitest/config";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // "server-only" throws outside a React Server Component bundle; in unit
      // tests we are on the server anyway, so swap it for an empty module.
      "server-only": path.resolve(root, "test/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Generating 1600×1200 test scenes with sharp takes a moment.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
