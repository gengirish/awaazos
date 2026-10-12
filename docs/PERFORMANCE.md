# Mobile performance

Who this is for: a home kitchen on a budget Android phone on 4G, and its buyers, who open the
storefront (`/s/[slug]`) from Instagram's in-app browser. JavaScript they must download and run
before the page works is the cost that matters most.

## The CI gate: bundle-size budget

`npm run perf:budget` (`scripts/check-bundle-budget.mjs`) reads the production build in `.next/` and
fails when first-load JavaScript outgrows `perf-budget.json`. It runs in CI in the
`Lint + Type + Unit + Build` job, right after `Build`. No server, browser or network is involved.

What it measures, per route: the gzip size of every JS file the first load needs — the shared
runtime, each layout above the page, and the page. Next's own "First Load JS" column leaves out the
chunks that only the layouts pull in, so the script's numbers are a little higher and closer to what
a phone downloads. Chunks loaded later (`next/dynamic`, `import()`) are not counted. 1 kB = 1000 B.

`perf-budget.json` holds:

- `sharedKb` — the runtime every page loads (`rootMainFiles`);
- `routesKb` — the screens that matter most, each with its own ceiling;
- `anyRouteKb` — a ceiling for every other route, so a new heavy page is caught too.

Budgets are the measured size plus `headroomPercent` (8%).

When it fails:

1. `ANALYZE=true npm run build`, then open `.next/analyze/client.html` to see what grew.
2. Fix it if you can (see "Keeping it small").
3. If the growth is intended: `npm run build && npm run perf:budget -- --update`, commit
   `perf-budget.json`, and say in the PR what was added and why it is worth the bytes.

After a real reduction, run `--update` too, so the saving is locked in.

A build without `NEXT_PUBLIC_SENTRY_DSN` (CI) and one with it (production) produce the same
first-load chunks; the DSN only decides whether the lazy Session Replay chunk exists.

## Lab numbers: Lighthouse (manual)

Lighthouse is not in CI: on a shared runner the score moves by ±5 between identical runs, which is
either a flaky gate or a meaningless one. Run it by hand against a local production build and a
throwaway Postgres (never production — signed-in pages read the database on every run):

```bash
npm run build && npx next start -p 3102
BASE_URL=http://localhost:3102 PERF_PATHS=/,/sign-in,/s/<slug> npm run perf:lighthouse
# signed-in pages: the test vendor's session cookie
PERF_AUTH_PATHS=/orders,/pos,/menu,/transactions PERF_COOKIE="authjs.session-token=…" \
  BASE_URL=http://localhost:3102 npm run perf:lighthouse
```

It runs each page `PERF_RUNS` times (default 3) with Lighthouse's mobile emulation and simulated
slow-4G throttling and prints the median. Read the numbers as a trend, not a measurement:

- a fresh Lighthouse profile always shows the cookie banner, which is the largest text block on most
  screens, so LCP is "when the banner painted";
- simulated LCP is a model that charges script execution to LCP. After the banner moved into the
  server HTML, the *observed* LCP equals FCP on every page, while the simulated figure only fell
  by about a quarter.

## Baseline (2026-10-12, local, seeded store)

Median of 3–5 Lighthouse runs on a developer laptop; expect ±5 on the score and ±15% on TBT.

| Page | Perf | LCP (simulated) | TBT | CLS | First-load JS |
|---|---|---|---|---|---|
| `/s/[slug]` (storefront) | 67 → 72 | 4.5 s → 3.6 s | 660 → 700 ms | 0 → 0 | 264 → 213 kB |
| `/` | 66 → 79 | 4.4 s → 3.2 s | 765 → 525 ms | 0 → 0 | 230 → 179 kB |
| `/sign-in` | 67 → 86 | 4.1 s → 2.1 s | 850 → 520 ms | 0 → 0 | 229 → 182 kB |
| `/orders` | 60 → 74 | 5.1 s → 3.1 s | 885 → 825 ms | 0 → 0 | 285 → 244 kB |
| `/pos` | 60 → 75 | 4.9 s → 2.6 s | 1040 → 975 ms | 0 → 0 | 306 → 248 kB |
| `/menu` | 58 → 75 | 5.2 s → 2.7 s | 945 → 800 ms | 0 → 0 | 322 → 281 kB |
| `/transactions` | 64 → 72 | 4.5 s → 2.9 s | 850 → 1155 ms | 0 → 0 | 279 → 239 kB |

"First-load JS" is the budget script's figure (deterministic); the rest is lab noise around a real
improvement. TBT did not move beyond noise: it is hydration plus the Sentry and Next runtimes.

## What every page loads (shared runtime, 162 kB gzip)

| Part | gzip |
|---|---|
| React DOM | 53 kB |
| Sentry browser SDK (`@sentry/core`, `browser`, `browser-utils`, `nextjs`): errors + tracing | ~48 kB |
| Next.js client runtime (router, RSC client) | ~45 kB |
| Everything else (webpack runtime, `sentry.client.config.ts`) | ~4 kB |

Before this pass it was 200 kB: Session Replay (37 kB) sat in the same chunk group. It now loads on
idle in its own 33 kB chunk (see `OBSERVABILITY.md` §1).

On top of that the root layout adds ~13 kB to every page (`tailwind-merge` 7 kB via `Button`, the
cookie banner, `next/link`).

## Keeping it small

- **Root layout (`app/layout.tsx`) is on every page, including the storefront.** No client
  providers, no toast host, no analytics widgets there. Put them in the route group that needs them
  (`app/(vendor)/layout.tsx` has the `Toaster`).
- **`import type` from `@prisma/client` in client components.** A value import (an enum such as
  `PaymentMethod.UPI`) pulls Prisma's browser bundle in: 17 kB gzip on `/pos` until it was replaced
  with the string literal.
- **Do not lazy-load what the POS needs to take a payment** (`UpiQRModal`, `ReceiptModal`,
  `lib/qr.ts`). The service worker caches the chunks referenced by the `/pos` HTML; a chunk that is
  only fetched when a modal opens is not there when the counter is offline.
- **The cookie banner is server-rendered.** It must stay in the first HTML: rendering it after
  hydration made it the LCP element at ~4.5 s. Returning visitors are handled by the inline script
  in `lib/cookie-pref.ts` + the `html[data-cookie-pref]` rule in `app/globals.css`.
- **Fonts.** Only Nunito's `latin` and `latin-ext` files are downloaded (the rupee sign lives in
  `latin-ext`). Baloo 2 is declared but never requested, because nothing renders in it
  (see the note in `app/globals.css`); if that is ever fixed it adds two font files per page.

## Known, not done

- **Sentry tracing in the shared bundle.** `bundleSizeOptimizations.excludeTracing` would cut a
  further slice of the 48 kB, at the price of losing browser performance traces (10% sampled today).
- **Session Replay on the storefront.** It still downloads (33 kB, after idle) on every first visit.
  Loading it only inside the signed-in app would save buyers that, and lose replays of buyer errors.
- **Storefront checkout sheet.** `StorefrontCheckout` (~6 kB gzip) and the dialog primitives
  (~13 kB) could be `next/dynamic`, preloaded when a buyer first adds to the cart.
- **Storefront HTML is rendered per request** (`force-dynamic`, because cut-offs are evaluated
  lazily). Nothing is cached; TTFB is one Neon round trip, plus a cold start if the database slept.
- **Middleware is 147 kB** (server-side, not downloaded by phones): Auth.js + `jose` in
  `middleware.js` (~92 kB) and the Sentry edge SDK in `edge-instrumentation.js` (~51 kB). It only
  affects edge cold starts.
- **Nav prefetch.** The app shell's tab bar prefetches three routes per page view. In a production
  build each is a ~150 B response from the `loading.tsx` boundary and runs **no** SQL, so it was
  left on.
