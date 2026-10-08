# Runbook: Tailwind CSS 4 + ESLint 9 migration

Why: `npm audit --audit-level=high` failed on GHSA-vfj7-8cjw-p6xm (`braces`, no
patched version). It reached us through tailwindcss 3 (chokidar, fast-glob,
micromatch) and eslint-config-next 15 (`@next/eslint-plugin-next` → `fast-glob`
→ `micromatch` → `braces`). After this runbook: `found 0 vulnerabilities`.

This is written to be **re-applied** on top of another branch. Every step is a
command or an exact edit. Steps 1–8 are Tailwind, 9–14 are ESLint/audit, 15 is
verification. Budget about 15 minutes plus build and test time.

Versions: tailwindcss 3.4.19 → 4.3.3 (+ `@tailwindcss/postcss` 4.3.3),
tailwindcss-animate 1.0.7 → tw-animate-css 1.4.0, autoprefixer removed,
eslint 8.57.1 → 9.39.5 (+ `@eslint/eslintrc` 3.3.7), eslint-config-next stays
15.5.x, tsx 4.21 → 4.23 (lockfile only, pulls esbuild 0.28.2).

> **Already migrated and rebasing onto new main?** Skip to
> [Rebasing this branch onto a main that gained Tailwind 3 code](#rebasing-this-branch-onto-a-main-that-gained-tailwind-3-code).
> Do not re-run `@tailwindcss/upgrade` on the migrated tree, because it does
> nothing useful there.

---

## Tailwind 4

### 1. Start from a clean tree

```bash
git status --short          # must be empty: the upgrade tool refuses a dirty tree
npm ci
```

### 2. Run the official upgrade tool

```bash
npx -y @tailwindcss/upgrade@4.3.3
```

What it does on this repo:

- turns `tailwind.config.ts` into an `@theme` block in `app/globals.css` and deletes the config file
- `@tailwind base/components/utilities` → `@import 'tailwindcss'`
- `postcss.config.js` → `{ '@tailwindcss/postcss': {} }`, installs `@tailwindcss/postcss`, removes `autoprefixer`
- bumps `tailwindcss` to `^4.3.3`
- renames utilities in about 67 files: `shadow-sm→shadow-xs`, `shadow→shadow-sm`,
  `outline-none→outline-hidden`, `outline→outline-solid`, `backdrop-blur→backdrop-blur-sm`,
  `bg-gradient-to-*→bg-linear-to-*`, `[var(--x)]→(--x)`, `data-[disabled]→data-disabled`,
  `aria-[invalid=true]→aria-invalid`, variant order (`[&>tr]:last:` → `last:[&>tr]:`), and so on.
  None of these repo files use a bare `ring`.
- it **silently drops** the `tailwindcss-animate` plugin. Step 4 replaces it.

### 3. Undo the tool's false positive: the `outline` *variant* prop

The tool reads the string `"outline"` as the v3 `outline` utility and rewrites it
to `"outline-solid"`, including in `<Button variant="outline">` /
`<Badge variant="outline">` props and their TS unions. That breaks `tsc`.

```bash
grep -rn '"outline-solid"' app components      # every hit should be a variant prop/union
grep -rl '"outline-solid"' app components | xargs sed -i 's/"outline-solid"/"outline"/g'
```

If a hit really is a `className`, leave it as `outline-solid`. On the first
pass all 6 lines were variant props, in DropForm, OrderCard, PricingTeaser,
PushAlertsButton and TransactionDetailDrawer.

### 4. Swap tailwindcss-animate for tw-animate-css

Radix dialog, sheet and select use `animate-in`, `fade-in-0`,
`slide-in-from-*` and `zoom-in-95`.

```bash
npm uninstall tailwindcss-animate
npm install tw-animate-css@^1.4.0
```

### 5. Edit `app/globals.css`

Change the **top of the file** (everything above `@theme`) to:

```css
@import 'tailwindcss' source(none);
/* Radix enter/exit classes (animate-in, fade-in-0, slide-in-from-*, zoom-in-95…);
   Tailwind-4 replacement for the tailwindcss-animate plugin. */
@import 'tw-animate-css';

/* Explicit class-scanning roots (v3 `content` was app/ + components/). Docs,
   e2e and scripts are deliberately not scanned. */
@source '../app';
@source '../components';
@source '../lib';
@source '../hooks';

@custom-variant dark (&:is(.dark *));

/* v3 parity: v4's `hover:` only matches on hover-capable pointers. Keep the v3
   behaviour (apply on :hover everywhere) so touch POS screens look the same. */
@custom-variant hover (&:hover);
```

Then make these edits:

a. **`@theme {` → `@theme inline {`. This one is critical.** Without `inline`,
   `--color-primary: hsl(var(--primary))` gets resolved once on `:root`, so
   the storefront's `[data-theme="green|blue|…"]` vendor themes and `.dark`
   stop changing colours. `next/font` also puts `--font-nunito` on `<body>`,
   not `:root`, so every font falls back to system-ui. `inline` writes the
   `var()` into each utility so it resolves on the element, as v3 did.

b. Leave the `--font-display` line **unquoted**, exactly as the tool writes it:
   `--font-display: var(--font-baloo), Baloo 2, system-ui, sans-serif;`. The
   unquoted `Baloo 2` makes that declaration invalid, so `font-display` has
   always rendered as the inherited Nunito. v3 compiled the same invalid CSS,
   and quoting it would switch about 70 headings to Baloo 2. Keep the comment
   above it that explains this.

c. In the `@layer base` block the tool added (the `border-color:
   var(--color-gray-200, currentcolor)` compat), add these after the
   border rule:

```css
  /* v3 parity (official v4 upgrade guide): placeholders were gray-400, and
     buttons showed a pointer cursor. */
  input::placeholder,
  textarea::placeholder {
    color: #9ca3af; /* v3 gray-400 */
  }

  button:not(:disabled),
  [role='button']:not(:disabled) {
    cursor: pointer;
  }
```

d. Right after that `@layer base` block, add the `space-*` compat. Without it
   about 10% of pixels move on form-heavy screens: label-to-input gaps
   disappear, and a card under an sr-only heading loses its top margin.

```css
@utility space-y-* {
  & > :not([hidden]) ~ :not([hidden]) {
    margin-top: calc(var(--spacing) * --value(number));
    margin-bottom: 0;
  }
  :where(&) > :is(html *) {
    margin-bottom: 0;
  }
}

@utility space-x-* {
  & > :not([hidden]) ~ :not([hidden]) {
    margin-left: calc(var(--spacing) * --value(number));
    margin-right: 0;
  }
  :where(&) > :is(html *) {
    margin-right: 0;
  }
}
```

   (Keep the explanatory comment from the committed file.) This re-emits v3's
   selector and cancels v4's `margin-bottom` with a 0-0-1 rule, so a child's
   own `mb-*` still wins, as it did in v3. It only covers numeric values. If
   the new branch adds `space-y-[…]`, `-space-y-*` or `space-y-reverse`,
   extend it or move that container to `gap-*`.

### 6. Pin line-heights where `leading-*` meets a responsive text size

In v3 a later `sm:text-4xl` reset line-height and beat a base `leading-tight`.
In v4, `leading-*` always wins. Find these combinations:

```bash
grep -rnoE 'className=["{`][^"`]*' app components \
  | grep -E '(^|[ "`])leading-[a-z0-9]+' \
  | grep -E '(sm|md|lg|xl|2xl):text-(xs|sm|base|lg|xl|[2-9]xl)'
```

For each hit, add the v3 line-height of the responsive size next to it at the
same breakpoint. The v3 defaults are: xs 1rem (`leading-4`), sm 1.25rem
(`leading-5`), base 1.5rem (`leading-6`), lg 1.75rem (`leading-7`),
xl 1.75rem (`leading-7`), 2xl 2rem (`leading-8`), 3xl 2.25rem (`leading-9`),
4xl 2.5rem (`leading-10`), and 5xl–9xl 1 (`leading-none`). First pass:

- `app/s/[slug]/page.tsx` storefront `<h1>`: `sm:text-4xl` → add `sm:leading-10`
- `components/marketing/Hero.tsx` `<h1>`: `sm:text-5xl lg:text-6xl` → add `sm:leading-none`

### 7. Point the shadcn config away from the deleted JS config

In `components.json`, set `"tailwind": { "config": "" … }`.

### 8. Do **not** upgrade tailwind-merge

Stay on `tailwind-merge@^2.6`. v3 (the Tailwind 4 line) changes how `cn()`
merges in ways you can see:

- a later `text-2xl` now removes `leading-none` (CardTitle grows from 24px to 32px)
- `font-display` is no longer treated as a font-weight, so CardTitle's
  `font-semibold` comes back

Upgrading it is a separate, visual change.

Docs touched: `.cursor/rules/design-system.mdc` (globs plus the font-mapping
sentence now point at `@theme` in `app/globals.css`) and `.dockerignore`
(`tailwind.config.ts` → `eslint.config.mjs`, `.eslintrc.json` removed).

---

## ESLint 9 (flat config) and audit

### 9. Why eslint-config-next stays on 15.5.x

`eslint-config-next@16` (peer: `eslint >=9`, no `next` peer) is released for
Next 16. It bundles `eslint-plugin-react-hooks` 7 with the React-Compiler rules,
so it is **not** rule parity. It also still depends on
`@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch` → `braces`, so
it would not fix the audit either. 15.5.x supports ESLint 9 (peer
`^7.23 || ^8 || ^9`). The vulnerable path is removed with an override (step 10).

### 10. Install, then override fast-glob with tinyglobby

`@next/eslint-plugin-next` uses fast-glob in one place
(`dist/utils/get-root-dirs.js`): `globSync(pattern, { onlyDirectories: true })`,
and only when `settings.next.rootDir` is set, which this repo does not use.
`tinyglobby` exports the same `globSync` with the same option and has no
micromatch or braces dependency.

```bash
npm install -D eslint@^9.39.5 @eslint/eslintrc@^3.3.7
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
p.overrides["@next/eslint-plugin-next"]={"fast-glob":"npm:tinyglobby@^0.2.17"};
p.scripts.lint="eslint . --max-warnings=0";
p["lint-staged"]["*.{js,jsx,ts,tsx,mjs,cjs}"]=["eslint --max-warnings=0 --no-warn-ignored"];
fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");'
# npm keeps an already-locked nested copy, so drop it from the lockfile before installing:
node -e '
const fs=require("fs");const l=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
for (const k of Object.keys(l.packages)) if (k.startsWith("node_modules/@next/eslint-plugin-next/node_modules/")) delete l.packages[k];
fs.writeFileSync("package-lock.json",JSON.stringify(l,null,2)+"\n");'
rm -rf node_modules/@next/eslint-plugin-next/node_modules
npm install
npm ls fast-glob braces micromatch     # expect only: fast-glob@npm:tinyglobby@0.2.17 overridden
node -e "console.log(typeof require('fast-glob').globSync)"   # function
```

### 11. Replace `.eslintrc.json` with `eslint.config.mjs`

```bash
rm .eslintrc.json
```

Create `eslint.config.mjs` by copying the committed file. In outline:

```js
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
export default [
  { ignores: [".next/**","out/**","build/**","dist/**","node_modules/**","coverage/**",
              "playwright-report/**","test-results/**","tests/golden/**/.last-run/**",
              ".kilo/**",".vercel/**",".turbo/**","public/uploads/**","tmp/**","next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),          // == old .eslintrc.json
  { linterOptions: { reportUnusedDisableDirectives: "off" } },  // eslint 8 default
];
```

`reportUnusedDisableDirectives: "off"` keeps parity. ESLint 9 warns by
default, and `--max-warnings=0` would then fail on existing directives in
`lib/customer-auth.ts` and `public/sw.js`.

`eslint .` lints the whole repo (about 340 files, including e2e/, scripts/,
workers/ and public/sw.js). `next lint` covered fewer directories, but
lint-staged already linted every staged file, so the result is 0 problems.
`--no-warn-ignored` in lint-staged stops "file ignored" warnings from
failing the hook under `--max-warnings=0`.

### 12. CI and docs

`.github/workflows/ci.yml` calls `npm run lint`, so it needs no change. In
`CLAUDE.md` and `README.md`, change the `npm run lint  # next lint` comments.

### 13. Clear the low esbuild advisory (dev-only)

```bash
npm update tsx          # stays inside ^4.19.2; pulls esbuild ~0.28 (patched)
```

### 14. Audit

```bash
npm audit fix           # no --force
npm audit --audit-level=high    # expect: found 0 vulnerabilities
```

---

## 15. Verify

Use a throwaway DB only, never `.env`:

```bash
export DATABASE_URL="postgresql://ci:ci@localhost:5434/awaazos?schema=public" DIRECT_URL="$DATABASE_URL" \
       AUTH_SECRET=dev-secret-for-local-only-0123456789 AUTH_TRUST_HOST=true
npx prisma generate
npx tsc --noEmit && npm run lint && npx vitest run && npm run test:drops:db && npm run build
npx next start -p 3980 &
BASE_URL=http://localhost:3980 npx playwright test --project=chromium
```

Visual parity: take full-page Playwright screenshots of the key screens at
390×844 and 1366×768 **before** step 2 and again after step 15, then
pixel-diff them (pixelmatch, threshold 0.1). Use these settings:
`reducedMotion: "reduce"`, `animations: "disabled"`, cookie banner
pre-accepted, and `api.qrserver.com` stubbed. The key screens are sign-in
(also with a focused input), POS, menu, settings hub, settings/payments,
orders board, drops edit, storefront with an open drop, storefront checkout
sheet, buyer order page, marketing home and pricing. Expected result: 0.000%
everywhere, except countdown or "last checked" text, and sub-pixel
anti-aliasing (<0.1%) around a focused ring or an open sheet.

Quick runtime checks in the browser console on `/s/<slug>`:

- setting `data-theme="green"` on the page wrapper turns `bg-primary` into
  `rgb(33,196,93)`
- adding `.dark` to `<html>` makes the body background `rgb(2,8,23)`
- `rounded-sm` is 4px
- Radix sheets animate (`animation-name: enter`)

---

## Rebasing this branch onto a main that gained Tailwind 3 code

Done once already: rebasing onto 0cf740a, which brought in PR #20 (POS offline)
and PR #21 (public legal pages). Took about 10 minutes plus verification.

### R1. Rebase, and take main's side of every conflict

```bash
git fetch origin && git rebase origin/main
# On conflicts (last time: components/pos/VoiceOrderButton.tsx and package-lock.json):
git checkout --ours <conflicted .tsx files> package-lock.json   # in a rebase, --ours = origin/main
```

- **Components:** take main's behaviour unchanged. Its Tailwind 3 classes get
  converted in R3, so never hand-merge class strings.
- **package-lock.json:** never hand-merge it. With main's lockfile in place,
  `package.json` has already auto-merged (main's new deps plus this branch's
  Tailwind/ESLint deps and overrides). Regenerate:

```bash
node -e '
const fs=require("fs");const l=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
for (const k of Object.keys(l.packages)) if (k.startsWith("node_modules/@next/eslint-plugin-next/node_modules/")) delete l.packages[k];
fs.writeFileSync("package-lock.json",JSON.stringify(l,null,2)+"\n");'
rm -rf node_modules/@next/eslint-plugin-next/node_modules
npm install && npm update tsx        # tsx: main's lock pins esbuild 0.27.x (low advisory)
npm audit                            # found 0 vulnerabilities
git add <files> package-lock.json && GIT_EDITOR=true git rebase --continue
```

### R2. Do NOT run the upgrade tool on the migrated tree

On a v4 project, `@tailwindcss/upgrade` sees `tailwindcss@4` and only does v4
canonicalisations, such as `min-h-[3rem]` → `min-h-12`. It **cannot** tell
that main's `outline-none` / `shadow-sm` / `rounded-sm` were written for v3,
because those names are also valid in v4 with a different meaning. It
silently leaves them, and you lose v3 parity.

### R3. Run the tool in v3 mode on a throwaway checkout of main, then copy over main's changed files

```bash
T=<scratch dir outside the repo>
git worktree add --detach "$T" origin/main
(cd "$T" && npm ci --ignore-scripts && npx -y @tailwindcss/upgrade@4.3.3)
for f in $(git diff --name-only <old-base>..origin/main | grep -E '\.(tsx|ts|jsx|js|css)$'); do
  [ -f "$T/$f" ] && ! git -C "$T" diff --quiet -- "$f" && cp "$T/$f" "$f" && echo "copied $f"
done
git diff        # the new renames
```

`<old-base>` is the main commit this branch was last based on (c5d288f for
the first rebase, 0cf740a for the next). Skip `app/globals.css` and
`package*.json` in that list. Then:

- re-apply this branch's manual edits that the copy overwrote. Check with
  `git diff`: anything that **removes** `sm:leading-*` from the storefront
  or Hero `<h1>`, or turns a variant back into `"outline-solid"`, must be
  restored (`git checkout <file>` when the copy added nothing new)
- run the step 3 grep (`'"outline-solid"'`) and the step 6 leading/responsive-text grep
- `grep -noE "[a-z:-]*space-[xy]-[^ \"'\`}]+"` over the changed files.
  Numeric `space-y-N` / `space-x-N` is covered by the step 5d parity block;
  anything else (`space-y-[…]`, `-space-*`, `space-*-reverse`) needs handling
- remove the scratch worktree. On Windows a deep `node_modules` makes
  `git worktree remove` fail with "Filename too long". Use
  `cmd /c rmdir /s /q "\?\<path>"`, then `git worktree prune`

Sanity check: for every file the tool touched, the tool's output should now
match the branch byte for byte (ignoring CRLF), apart from the documented
manual edits.

Last time this gave: PosSyncStatus `focus-visible:outline-none` →
`outline-hidden`, VoiceOrderButton `focus-visible:outline-none` →
`outline-hidden` and `min-h-[3rem]` → `min-h-12`. The other #20/#21 files had
already come through the rebase with their renames, and #21 had no class
changes. The new space-y usages were all numeric.

Second rebase onto 5b5c095 (PR #23, plan copy) followed the same steps.
- One conflict: `app/(marketing)/pricing/page.tsx`. Taking main's side
  dropped this branch's `shadow-sm→shadow-xs` there, and R3 put it back.
- New renames from R3: pricing `shadow-sm→shadow-xs`, TransactionsTable
  `focus-visible:outline-none→outline-hidden`.
- False positives reverted again in DropForm and PricingTeaser (`"outline-solid"`).
- `package.json` gained only a script, so the lockfile merged cleanly and
  needed no regeneration. `npm ci` confirms that.

**Taking main's side in a conflict throws away this branch's renames in that
file, so always run R3 over the conflicted files too.**

### R4. Schema drift on the throwaway DB

If main changed `prisma/schema.prisma` (#20 added a nullable
`Transaction.clientRef` plus `@@unique([vendorId, clientRef])`), run
`npx prisma db push --skip-generate --accept-data-loss` against the
**throwaway** DB only. The "data loss" warning is just the unique constraint,
and NULLs never collide.

### R5. Visual parity for new screens

Add main's new UI states to the screenshot set. For POS offline: visit `/pos`,
wait for `navigator.serviceWorker.controller`, reload, wait for
`caches.match("/pos")`, then `context.setOffline(true)` and reload. Capture
the offline banner, a cash sale's receipt ("Offline #N"), and "N sales
waiting to sync". Close the context **while still offline** so the queued
sales never sync into the DB.
