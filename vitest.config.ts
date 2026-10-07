import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 transforms with oxc, which honours tsconfig's `jsx: "preserve"` (set
  // for Next) and leaves JSX untransformed. Compile it the way Vitest 2's
  // esbuild did: classic runtime (tests that render JSX put React on globalThis).
  oxc: { jsx: { runtime: "classic" } },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, ".kilo/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
