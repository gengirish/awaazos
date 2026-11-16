---
description: Store wording, landing screen, onboarding gate, setup checklist, tab bar, install, in-app Help, moved from CLAUDE.md
paths: ["lib/store-vocabulary.ts","lib/home.ts","lib/app-nav.ts","lib/help-guide.ts","lib/settings-overview.ts","lib/setup-checklist-server.ts","lib/store-hub.ts","lib/install-guide.ts","app/home/**","app/(onboarding)/**","app/(vendor)/layout.tsx","app/(vendor)/_shell-context.ts","app/(vendor)/help/**","app/(vendor)/store/**","app/(vendor)/settings/**","components/setup/**","components/pwa/**","components/shell/**","components/store/**","components/help/**","components/settings/**","hooks/useInstallPrompt.ts","hooks/usePushAlerts.ts"]
---

<!-- Generated from .cursor/rules/app-shell.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Store wording

Moved out of CLAUDE.md so it loads only when matching files are in play. CLAUDE.md keeps the cross-cutting rules.

## Store wording: kitchens and everyone else (`lib/store-vocabulary.ts`)

The app's words for the catalogue follow `Vendor.stallType`. `storeKind()` sorts every type into
`food` (kitchens, bakeries, cafés, sweets, catering, street food, carnival, school canteen, and
`GENERAL`, the sign-up default most existing kitchens carry) or `goods` (Other, Kirana, Clothing,
Services, Event pop-up), and `storeVocabulary()` returns that kind's words: "Menu" / "Products",
"dish" / "product", "Prep sheet" / "Packing list", "Order from menu" / "Order any time". **Wording
only**: routes (`/menu`), models (`MenuItem`), API fields and settings (`acceptMenuOrders`) keep
their names. The shell gets `storeKind` from `getShellContext()`, Settings pages from
`requireSettingsContext()`; client components take a `storeKind` prop. Fixed copy (the Help guide,
the setup checklist, Settings section blurbs) holds `{token}`s filled by `fillVocabulary()`; read
the guide only through `helpTopicsForRole(role, published, kind)` / `helpGroupsFor` /
`orderJourneyFor` / `helpScreenSummary`. A kitchen must read exactly as before; new copy that names
the catalogue goes through the vocabulary, not a literal "menu" or "dish".

**Landing screen and the installed app** (`lib/home.ts`): sign-in, sign-up, the end of onboarding and
the manifest `start_url` all point at `/home` (`app/home/page.tsx`, Node, redirect only), which is the
one place the rule lives: setup unfinished → `/onboarding`, `publishStorefront` → `/orders`, otherwise
`/pos`. An explicit `callbackUrl` never goes through it. Never decide this in middleware (it needs
Postgres). Setup is also a gate: every `(vendor)` page sends a store without `onboardingDone` to
`/onboarding` (`getShellContext`, no exceptions), where non-owners get a waiting screen; resume uses
`Vendor.onboardingStep`. Every step needs an answer (≥ 1 way to get paid, ≥ 1 item, drops / menu orders /
both, pickup / delivery; voice loads inside the step), and each saves on Next with its own fields, not the
Settings widgets (those save themselves and toast). An unfinished store may turn `acceptMenuOrders` on before
publishing. The last step lists every answer with a Change link and publishes in the same PATCH that sets
`onboardingDone` ("Finish without publishing" leaves it hidden). Plan for the step-by-step setup: `docs/ONBOARDING_PLAN.md`. E2E `signIn()` finishes
setup through the API unless `finishSetup: false`. `public/sw.js` repeats the `/home` literal: with no network it answers that navigation
with a redirect to `/pos` when a cached `/pos` exists, so the Home Screen icon still opens the offline
till. Manifest `id` stays `"/"`. Install affordances (`components/pwa/InstallPrompt.tsx`) and every
copy of the phone-alerts opt-in (`components/push/PushAlertsButton.tsx`) are views over module-level
stores (`hooks/useInstallPrompt.ts`, `hooks/usePushAlerts.ts`) — add a copy, never a second detector.
iPhone/iPad also get a step-by-step dialog from `@khmyznikov/pwa-install` (`lib/install-guide.ts`, loaded on
the tap, version pinned). Never on Chromium: it would replace the one-tap prompt, and its Android sheet has no close button.
Both are event-driven: no timers, no polling.

**Setup checklist and billing notices** follow the seller to where they land: `/orders`, `/drops` and
(collapsed) `/pos` render `SetupChecklistCard` (`components/setup/`, rules in `setupChecklist()` /
`checklistForRole()` in `lib/settings-overview.ts`, loaded by `lib/setup-checklist-server.ts` on page
render only) and `BillingAccessNotice` (`components/billing/TrialNotice.tsx`). Steps are role-trimmed;
a CASHIER sees none. The phone tab bar depends on the store too: `appTabBarForRole(role, published)`
in `lib/app-nav.ts` is Orders · Menu · Store · Settings for a published store (Sell for an unpublished
one; a cashier gets Orders · Sell · Store), Store raised in the middle (`APP_CENTRE_TAB`); Drops and the
rest are behind More. `/store` (`components/store/StoreHubClient.tsx`, words in `lib/store-hub.ts`) is a
header preview, what buyers can order now, the tagged Instagram bio / WhatsApp links, story image, QR, the
owner's Publish and look rows into `/settings/store#<card>`. `/help` must use the same function (`helpTopicsForRole(role, published)`).

## In-app Help (`/help`)

A self-help guide to getting around, linked from the shell (the "More" sheet on phones, the rail from
md). All content is in `lib/help-guide.ts` (pure, client-safe) and is trimmed to the viewer's role
through `lib/app-nav.ts`, so it never points a cashier at a screen their navigation hides. The page is
static — no reads beyond the shell's. **When you rename a screen, a Settings section or a button the
guide quotes, update `lib/help-guide.ts`**; `lib/__tests__/help-guide.test.ts` catches drifted
Settings titles and uncovered destinations, not button labels.

**Help videos** (`lib/help-videos.ts`): short narrated phone films from the demo-video pipeline, each tied to
`HELP_TOPICS` / `ORDER_JOURNEY` ids, get a "Watch · 40 s" button that opens a `ResponsiveDialog` (the `<video>`
mounts only on open, so the page loads nothing extra; the transcript sits under it). Kitchen films are offered to food
stores only (`kinds`). The files are public Blob objects at `help-videos/<id>.mp4` / `.jpg`, encoded and uploaded by
`npm run help-videos:publish -- --from=<reels> --upload`; `HELP_VIDEO_BASE_URL` (server env, read per render) names the
folder, unset → no buttons. CSP `media-src` allows the Blob host. Re-record a film when the screen it shows changes,
and keep its `lines` in step with the captions.
