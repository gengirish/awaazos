# Cleanup plan: stale code, references and docs

Audit date: 2026-10-05, against `main` at `260b18a`. Nothing in this plan has been applied yet.
Findings come from three read-only sweeps: docs vs. code, dead code/deps, and repo hygiene.

**Progress (2026-10-07):** Phases 0–4 are done on branch `chore/cleanup-phase-0-1`. Still open:
- removing the Kilo worktree (its owner should do that);
- the retention trigger (TODO.md §5);
- the deferred Prisma fields (TODO.md §4.5);
- phone validation on `receipts/send` and `transactions` (TODO.md §4.4);
- D5, the production domain;
- PITCH/README marketing placeholders;
- Phase 5, the toolchain.

Decisions: D1 delete, D2 remove, D3 dormant, D4 archive to `docs/archive/`.

> **Drift since the audit:** `main` moved from `260b18a` to `907f57d`, with 13 commits touching 162
> files: wa.me receipts replaced Gupshup for POS, there is now Web Push, Drops, a settings hub, plus
> `public/` and `vercel.json`. Re-check every Phase 2–4 item against HEAD before acting on it.
> Gupshup and `GUPSHUP_APP_NAME` items in particular may no longer apply. Also, the untracked
> `docs/CLERK_MIGRATION_PLAN.md` proposes reversing the "no Clerk" decision, which affects how
> AGENTS.md, ARCHITECTURE.md and the auth docs get merged in Phase 4.

> **Concurrent work:** `prisma/schema.prisma` had uncommitted additions during the audit (Drop/DropItem
> models, fulfilment enums, `OrderSource.STOREFRONT`, `fssaiNumber`, `acceptPayOnDelivery`). There is
> also a Kilo worktree at `.kilo/worktrees/dorian-tricorne`. Land or coordinate that work first, and
> keep schema edits out of this cleanup.

## Open decisions (owner: Girish)

| # | Question | Blocks |
|---|---|---|
| D1 | `app/api/_metrics`: delete it and point docs at `/admin/metrics`, or rename the folder so it is served? | Phase 1, Phase 4 runbooks |
| D2 | NVIDIA STT ("legacy"): remove it, or keep it as an en/hi fallback? | Phase 2 |
| D3 | te/kn/ta (Sarvam): the UI only offers en/hi. Are they dormant (keep and document) or cut? | Phase 2, golden fixtures, docs |
| D4 | `awaazos-course/`, `DEMO_VIDEO.md`, `awaazos-cursor-prompt.md`: delete them, or move to `docs/archive/`? | Phase 4 |
| D5 | Production domain: `awaazos.vercel.app` or `awaazos.intelliforge.tech`? TODO.md:134 disagrees with every other doc. | Phase 4 |

## Verification (run after every phase)

```bash
npm test && npm run typecheck && npm run lint && npm run build
rg -l "toFixed" --glob '!lib/upi.ts' --glob '!*.md' app/ components/ lib/ workers/ hooks/
```

After Phases 1–3, also run Playwright against a throwaway Postgres, never production (see CLAUDE.md
"E2E writes real rows"). Make one conventional commit per phase.

---

## Phase 0: Repo hygiene (no decisions needed)

- [x] Delete untracked `install.cmd`. It is the Claude Code Windows installer, saved here by accident,
      and nothing references it.
- [ ] Once its owner is done, run `git worktree remove .kilo/worktrees/dorian-tricorne`. Until then
      it causes these problems:
  - vitest (`include: ["**/*.test.ts"]`) picks up its 30 duplicate test files;
  - `tsc` typechecks it, because tsconfig only excludes `node_modules`;
  - it isn't excluded from the Fly or Vercel upload contexts.
- [x] `.gitignore`: add `.kilo/` and `.claude/settings.local.json`. Today only `.git/info/exclude`
      and the user's global git ignore cover them.
- [x] `.dockerignore`: add `.kilo/`, `.claude/`, `tests/`, `e2e/`, `docs/`, `services/`, `awaazos-course/`.
- [x] `.vercelignore`: add `.kilo/`, `.claude/`, `services/`, `awaazos-course/`, `tests/golden/`.
- [x] `tsconfig.json`: set `"exclude": ["node_modules", ".kilo"]`.
- [x] `vitest.config.ts`: set `exclude: [...configDefaults.exclude, ".kilo/**"]`.
- [x] `tailwind.config.ts`: drop the `./pages/**` content glob, because `pages/` doesn't exist.
- [x] `lib/auth.config.ts:11`: drop `/features` from the public paths, because no such page exists.

## Phase 1: Dead code (no decisions needed except D1)

Remove these files. Nothing imports them, not even tests.

- [x] `lib/redis.ts`. It was superseded by `lib/kv.ts`. Also fix the stale mention in `lib/queues.ts:9`.
- [x] `types/index.ts`. Nothing imports `@/types`. Keep `src/types/next-auth.d.ts`, which is an
      ambient declaration and is needed.
- [x] `components/billing/SubscriptionGate.tsx`
- [x] `components/ui/dropdown-menu.tsx`, `separator.tsx`, `skeleton.tsx`, `tabs.tsx`
- [x] `components/ui/toaster.tsx`, `components/ui/toast.tsx`, `hooks/use-toast.ts`. These only import
      each other; the app uses sonner (`app/layout.tsx:4`).
- [x] `lib/__tests__/billsequence.test.ts`. It only exercises its own mock, never app code.
- [x] `scripts/sarvam-smoke.mjs`. It has no npm script and hardcodes the deprecated `saaras:v2`;
      `sarvam-roundtrip.mjs` replaces it.

Remove these unused exports:

- [x] `lib/ratelimit.ts:103` `aiRateLimit` and `:110` `aiBurstRateLimit`, superseded by `getAiLimiterForPlan`.
- [x] `lib/billing-period.ts:22` `getIstNow()`, which just returns `new Date()`.

Uninstall these npm packages:

- [x] `@neondatabase/serverless`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
      `@vitejs/plugin-react`. Vitest is node-only, `*.test.ts` only, with no plugins.
- [x] `@radix-ui/react-dropdown-menu`, `@radix-ui/react-separator`, `@radix-ui/react-tabs`,
      `@radix-ui/react-toast`. Only the dead components above use them.

Fix the unreachable route:

- [x] `app/api/_metrics/route.ts`: Next.js treats `_`-prefixed folders as private, and the route is
      absent from `.next/server/app/api/`. Apply **D1**. Its "TODO H6" comment points at `/admin`,
      which `app/admin/metrics` + `lib/admin-metrics.ts` already provide.

Leave these alone; they are used only by tests and are low value to remove:
`sumPaise`, `withRequestId`/`requestLogger`/`newRequestId`, `passwordStrength`, and the unused shadcn
sub-exports.

## Phase 2: Stale code paths

- [x] **NVIDIA STT (D2).** If you remove it, these all go:
  - the cascade step at `app/api/ai/transcribe/route.ts:84`;
  - the no-op quota branches at `:126-130` and `:150-151`;
  - `lib/nvidia.ts` and `lib/__tests__/nvidia.test.ts`;
  - `scripts/nvidia-smoke.mjs` and the `smoke:nvidia` npm script;
  - `tests/golden/stt/driver.ts:49,78`;
  - the `NVIDIA_*` env vars;
  - the `NEXT_PUBLIC_VOICE_NVIDIA_FALLBACK` alias at `hooks/useVoiceOrder.ts:62-66`.
- [x] **Unreachable branch** at `app/api/ai/transcribe/route.ts:265-283`. `requirePlan` (`:182`) runs
      before the cascade loop sets `lastSource`, so `featureBySource[lastSource]` is never used.
      Simplify it to the `isFallbackLang` result.
- [ ] **te/kn/ta (D3).** `VOICE_LANGUAGES` (`lib/constants.ts:97`) offers only en-IN and hi-IN. The
      Sarvam branch is reachable only through legacy rows or a direct PATCH to `/api/vendor`. If you
      cut them, also remove 11 parse-order and 6 STT golden fixtures.
- [ ] **Retention never runs automatically.** `app/api/admin/retention/run/route.ts:17` says "Vercel
      Cron (once daily)", but there is no cron config. The route is POST and needs an ADMIN session,
      and nothing in the UI calls it. Either wire a once-daily trigger or correct the comment and
      `requestedBy: "cron"` (`lib/queues.ts:52`). It touches Neon, so run it no more often than daily.
- [x] `workers/index.ts:104`: attach the Sentry `failed` handler to the retention worker too.
- [x] `hooks/useVoiceOrder.ts:54-55`: `WEBSPEECH_LANGS` and `FALLBACK_LANGS` are the same set. Merge them.
- [x] `prisma/schema.prisma`: the `User.passwordChangedAt` comment says enforcement is "a follow-up",
      but `lib/rbac.ts:72-77` already enforces it. Fix the comment once the concurrent schema work lands.
- [ ] **Unused Prisma fields: don't drop yet.** These are never referenced:
  - `Vendor.gstin`;
  - `VendorSettings.autoPrintReceipt`, `discountEnabled`, `hsnDefault`, `razorpayCustomerId`;
  - `Transaction.razorpayOrderId`, `razorpayPaymentId`, `paymentLinkUrl`;
  - `Receipt.pdfUrl`;
  - `OrderSource.WHATSAPP` and `OrderSource.API`.

  `VendorSettings.theme`, `taxEnabled` and `taxPercent` are read but never written (`Vendor.logoUrl`
  has been written by `POST /api/vendor/logo` since 2026-10-10).
  Dropping columns is destructive with `db push` and there are no migrations, so record these in
  TODO.md and decide later.

## Phase 3: Consolidate duplicate helpers (behaviour-preserving)

- [x] **IST "start of today".** `app/(vendor)/pos/page.tsx:9` `startOfTodayIST()` duplicates
      `lib/billing-period.ts:30` `getIstTodayStart()`. Use the lib version.
- [x] **IST date formatting.** Move these five local copies into one `lib/datetime.ts`:
  - `app/(vendor)/settings/billing/page.tsx:22`
  - `app/api/transactions/export/route.ts:33,42`
  - `lib/whatsapp-message.ts:14`
  - `components/transactions/TransactionDetailDrawer.tsx:48`
  - `components/transactions/TransactionsTable.tsx:61`
- [x] **Phone E.164 normalisation.** Add one helper (libphonenumber-js) and use it in:
  - `components/pos/ReceiptModal.tsx:51`, which builds +91 by hand;
  - `app/api/receipts/send/route.ts` and `app/api/transactions/route.ts:214`, which accept any string;
  - the existing callers in `lib/zod-auth.ts`, `register/route.ts` and `onboarding/page.tsx`.
- [x] **Last-4 masking.** Merge `export/route.ts:19` `maskCustomerPhone` with `lib/whatsapp.ts:8`
      `lastFourDigits`.
- [x] **Paise to rupees.** `HourlyHeatmap.tsx:34`, `PaymentMethodBreakdown.tsx:23` and
      `RevenueTrendChart.tsx:29` divide by 100 inline; use `paiseToRupees`. `export/route.ts:12`
      `csvPlainInr` has its own formatter.
- [x] **STT provider types.** The `SttSource` union is declared three times (`transcribe/route.ts:35`,
      `hooks/useVoiceOrder.ts:15`, `lib/queues.ts:35`), and the "is the provider configured" checks
      are duplicated in `tests/golden/stt/driver.ts:39-56`.
- [x] **`toFixed` outside `lib/upi.ts`.** It appears in `app/admin/metrics/page.tsx:24,48,92` and
      `lib/admin-metrics.ts:118`. None of these are money, but they break the CLAUDE.md rule. Either
      switch to `Intl.NumberFormat` or extend the rule's allowlist. The scripts and tests that use it
      are outside the grep paths.

## Phase 4: Docs

### Delete or archive (D4)
- [x] `awaazos-cursor-prompt.md`: the April kickoff build script. It references routes that don't
      exist (`/api/analytics/*`, `/api/upi/payment-link`), `migrate deploy` and Saaras v2. Remove the
      claims that it is the "authoritative spec" from README:313, AGENTS:13 and CLAUDE:231.
- [x] `awaazos-course/`: a generated HTML course from a single commit (8e42806). Nothing references
      it, and its content is frozen at April.
- [x] `DEMO_VIDEO.md`: a marketing script that repeats claims removed in d5a808f ("22 Indian
      languages", "Bharat AI Mission"). It also describes Razorpay UPI and automatic payment
      detection, neither of which exists, and links to a `public/demo.mp4` that doesn't exist.

### Merge
- [x] **AGENTS.md into CLAUDE.md**, leaving a pointer stub. AGENTS.md is stale in several places:
  - wrong repo path (`C:\Users\gengi\Documents\awaazos`);
  - out-of-repo skill and reference paths;
  - a finished Phase 1–4 plan;
  - `migrate dev` and `db seed` commands, though there are no migrations or seed;
  - "5 Indian languages" and Saaras v2.
- [x] **HARDENING.md into docs/OBSERVABILITY.md** (or a new `docs/README.md` index). Update the code
      comments that point at HARDENING sections that don't exist: `next.config.mjs:7` and
      `lib/password-strength.ts:6`.
- [x] **Redis-split explanation.** It is repeated in about 9 files. Keep the canonical copy in
      CLAUDE.md and link to it from the others.

### Fix in place
- [x] **`.env.local.example` (active bug)**
  - [x] `:25 SARVAM_STT_MODEL=saaras:v2` overrides the code default `saaras:v3`. Remove it or set v3.
  - [x] Add `RAZORPAY_PLAN_STARTER` and `RAZORPAY_PLAN_PRO`; subscriptions throw without them
        (`lib/razorpay.ts:26-31`). Also add `LOG_LEVEL`.
  - [x] Resolve the `AUTH_URL` contradiction between `:14` and `:124-127`.
  - [x] Note that `WHISPER_STT_SECRET` must be at least 16 characters, otherwise Whisper silently
        drops out of the cascade.
  - [x] Make the fallback flag comment (`:67-69`) list the real cascade.
  - [x] Blob is used for menu photos only, not logos or PDF receipts (`:119`).
- [x] **CLAUDE.md**
  - [x] Lines 35–61 have a broken fence: the E2E section was pasted inside the commands block, which
        swallows the "Golden tests" heading.
  - [x] Webhooks are let through by the `middleware.ts:15` matcher, not the `auth.config` allowlist
        (also fix `api-routes.mdc:67`).
  - [x] Line 225 runs prod e2e, which contradicts the file's own warning.
  - [x] Clarify that the golden `live.test.ts` matches the vitest glob and skips itself.
- [x] **README.md**
  - [x] Change Saaras v2 to v3 (:59, :75, :107, :285).
  - [x] Describe the full STT cascade.
  - [x] Fix "any Indian language" (:4) and "Today (May 2026)" (:10).
  - [x] Swap the Blob use (:113): menu photos have shipped; logos have not.
  - [x] `REDIS_URL` on Vercel is required, not optional (:201, :221).
  - [x] Add `GUPSHUP_APP_NAME` to the Fly secrets and drop `ANTHROPIC_API_KEY` (:211-217).
  - [x] Remove the prod e2e step and `vercel --prod` (:169, :232-233).
  - [x] HTTPS comes from HSTS in `next.config.mjs`, not the middleware (:244).
  - [x] Rewrite the repo tree (:252-316).
- [x] **ARCHITECTURE.md**
  - [x] External APIs box: add OpenAI, Groq, NVIDIA, Whisper and AgentMail. Workers don't call
        Anthropic (:55).
  - [x] `UserRole` is `USER | ADMIN | SUPER_ADMIN` (:106, :399).
  - [x] Field locations: `VendorSettings.razorpaySubId`, and `upiId`/`upiName` live on `Vendor`.
  - [x] voiceLang values have no mr/bn.
  - [x] `MenuItem.category` is a String; add `slug`, `aliases`, `tags` and `imageUrl`.
  - [x] `billNumber` and `receiptNumber` are not unique.
  - [x] Replace the `VoiceParseLog` fields with schema :303-316.
  - [x] Add `PasswordResetToken` and `publishStorefront` to the ERD.
  - [x] Confidence is `high|medium|low` with `shouldEscalate()`, and there is no `needsConfirmation`
        (:248-256).
  - [x] The cookie is `awz_vendor`.
  - [x] ENTERPRISE `analyticsDays` is 365.
  - [x] Queue names are `voice-parse-log` and `retention-maintenance`.
  - [x] Fix the voiceLog payload.
  - [x] Update the test counts (:515-520).
  - [x] HSN receipts have shipped (:534).
- [x] **docs/OBSERVABILITY.md**
  - [x] Fix the `/api/_metrics` section (§4) per D1.
  - [x] Hot routes (transcribe, transactions, parse-order) log with `console.log`, not pino, so the
        `service=awaazos` drain filter misses them. Fix the doc, or switch those routes to the logger.
  - [x] Remove the "future H7 heartbeat" line.
- [x] **docs/runbooks/**
  - [x] Fix the `/api/_metrics` links in DR_RESTORE:31, INCIDENT_RESPONSE:42, ON_CALL:17 and ROLLBACK:40.
  - [x] Add OpenAI, Groq, NVIDIA, Whisper (`awaazos-whisper-stt`) and AgentMail to the provider lists.
  - [x] ROLLBACK: cover the Whisper Fly app.
- [x] **PITCH.md**
  - [x] Six code comments cite a "minimal product cut list" that isn't in the doc:
        `pricing/page.tsx:13,62`, `BillingManageClient.tsx:17,61`, `PricingPlanButtons.tsx:8`,
        `PricingTeaser.tsx:5`, `e2e/public.spec.ts:24`. Add the section, or point the comments at d5a808f.
  - [x] Saaras v2.
  - [x] Add the STT providers that are already wired.
  - [x] GST/HSN has shipped (:389).
  - [x] Stale dates and placeholders.
- [x] **docs/DEMO_GUIDE.md**: it suggests Marathi, Bengali and te/kn/ta, none of which are selectable
      (:13, :51), and leaves out the cascade.
- [x] **TODO.md**
  - [x] Settle the domain (D5).
  - [x] Remove the dangling "positioning memo" reference (:80).
  - [x] Add the deferred Prisma field list from Phase 2.
- [x] **scripts/README.md**: document all six smoke scripts and their `smoke:*` npm scripts.
- [x] **tests/golden/parse-order/README.md**: use `npm run test:golden:validate` (:41, :99).
- [x] **.cursor/rules/**
  - [x] **voice-ai.mdc**
    - [x] Change Saaras v2 to v3.
    - [x] Add "empty cart, ≥2 words, no unmatched" to the escalation rules.
    - [x] The cache warmer isn't implemented.
    - [x] The te-IN fixtures listed don't exist.
  - [x] **api-routes.mdc**
    - [x] The plan-gate body is `{error, code, requiredPlan, currentPlan, feature}`.
    - [x] Pagination is offset (page/limit), not a cursor.
  - [x] **security-first.mdc**
    - [x] The example should use `timingSafeEqual`.
    - [x] The hot routes use `console.log`.
    - [x] The SDK is pinned with `^`.
    - [x] Data export isn't implemented.
  - [x] **design-system.mdc**: JetBrains Mono isn't loaded.
  - [x] **india-locale.mdc**
    - [x] CGST/SGST/IGST isn't implemented.
    - [x] Voice input is en/hi only.
    - [x] There is no voiceLang greeting.
  - [x] **accessibility.mdc**: axe isn't installed.
  - [x] **tenant-isolation.mdc**: tenant tests live in `e2e/tenant-isolation.spec.ts`, not Vitest.
  - [x] **money.mdc**: the glob `store/**` should be `lib/cartStore.ts`.
  - [x] **auth-rbac.mdc**: the "Razorpay link — PRO only" example is for a feature that doesn't exist.
- [x] **.cursor/skills/**
  - [x] **awaazos-claude-pipeline**
    - [x] Remove the out-of-repo absolute paths.
    - [x] Complete the escalation rules.
    - [x] Remove the cache warmer.
    - [x] Change Saaras v2 to v3 and add the cascade.
    - [x] Telemetry is `void` with `attempts:1`, not `await`.
  - [x] **awaazos-testing**: remove the component, DB and route-integration Vitest tests it describes
        (none exist), and fix its internal contradictions.

Keep as is: `docs/BRANCH_PROTECTION.md` (it matches the CI job names, though whether protection was
ever enabled is still open in TODO 4.3), `services/whisper-stt/README.md` and
`tests/golden/stt/README.md`.

## Phase 5: Toolchain (separate PRs)

- [ ] Node 20 reached end of life in April 2026. Bump `ci.yml` and `Dockerfile.worker`
      (`node:20-alpine`) to 22 or 24, and add `"engines"` to `package.json`.
- [ ] Merge the Dependabot branches for `actions/checkout` v7, `setup-node` v7 and `gitleaks-action`
      v3, and close the superseded v6 branches.
- [ ] Take the major npm bumps one PR at a time, each with its own testing: tailwindcss 4,
      tailwind-merge 3, @hookform/resolvers 5 and @vercel/blob 2.
- [ ] CI sets `REDIS_URL` with no Redis service in the e2e job. Confirm that's intentional; the
      pos-transaction spec already skips when Redis is down.
- [ ] Add `tests/golden/stt/audio/` clips, or note in the README that the STT live suite currently
      has no runnable cases (all 12 fixtures point at missing `.webm` files).
