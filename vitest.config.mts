import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Pure logic only — no jsdom, no Firestore, no Shopify. Fast enough to run
    // on every push.
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
