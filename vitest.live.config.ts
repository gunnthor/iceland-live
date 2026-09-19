import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Config for the live IMO integration check (`npm run test:live`).
 *
 * Kept separate from `vitest.config.ts` so the ordinary suite never reaches the
 * network: unit tests should pass on a plane.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.ts"],
    testTimeout: 60_000,
  },
});
