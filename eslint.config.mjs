// ESLint 9 flat config. Rule-for-rule equivalent of the old `.eslintrc.json`
// (`{ "extends": "next/core-web-vitals" }`): eslint-config-next 15 ships only
// legacy (eslintrc) configs, so FlatCompat translates them. That preset brings
// @next/next, react, react-hooks, jsx-a11y and import plugins with Next's rule
// selection — nothing is added or removed here.
//
// `npm run lint` is `eslint .`, which lints the whole repo (next lint only
// covered app/, components/, lib/, src/ by default). lint-staged already ran
// eslint on every staged file, so the wider scope adds no new rules.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Generated output, dependencies and local tooling (mirrors .gitignore).
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "tests/golden/**/.last-run/**",
      ".kilo/**",
      ".vercel/**",
      ".turbo/**",
      "public/uploads/**",
      "tmp/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    // ESLint 9 turned this on (warn) by default; eslint 8 had it off. Keep
    // parity so `--max-warnings=0` doesn't fail on the existing directives
    // (e.g. lib/customer-auth.ts, public/sw.js) that guard rules not in this preset.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
];

export default config;
