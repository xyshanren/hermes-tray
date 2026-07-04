// vitest config — extends vite.config.ts aliases so tests can use @/ paths
// and resolve react→preact/compat for any future .tsx tests.
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import path from "node:path";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react-dom/test-utils": "preact/test-utils",
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    // Include .tsx too so component tests can be written alongside .ts tests.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});