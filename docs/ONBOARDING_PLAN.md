# Onboarding consolidation plan

Status: decided 2026-11-07 (see "Decisions"). PR 1 (gate, `onboardingStep`) merged as #168; PR 2 (payments and items
required) in progress; PRs 3–4 not started.

## The problem

A new seller signs up (name, phone, store link), then goes through `/onboarding`, which has four steps:

| # | Step | Required? | Saves |
| --- | --- | --- | --- |
| 1 | Your store: city, state, store type | yes | `city`, `state`, `stallType` |
| 2 | Getting paid: UPI ID + UPI name | **skippable** | `upiId`, `upiName` |
| 3 | What you sell: up to 10 typed items, or "speak your menu" later | **skippable** | `POST /api/menu/bulk` |
| 4 | Order alerts: push opt-in, WhatsApp number | optional | `whatsappNumber`, `onboardingDone` |

It ends on "Your store is ready", but the store is **not ready**: it is unpublished, may have no items, no way to
pay and nothing to order from. What is missing is spread over four Settings pages and the checklist card
(`setupChecklist()` in `lib/settings-overview.ts`):

- **Publish**: Settings → Online store (or the prompt when the first drop opens)
- **Payment method**: Settings → Payments. `acceptPayOnDelivery` defaults to `true`, so this step looks done
  although the seller never chose it.
- **Something to order from**: `/drops/new`, or Settings → Online orders → "Order from menu"
- **Pickup / delivery, fee, slots, delivery areas**: Settings → Online orders
- **WhatsApp opt-ins, Instagram handle, FSSAI, tagline, logo**: Settings → Online orders / Online store

`/home` is also the only place that sends an unfinished store to `/onboarding`. A deep link (`/orders`,
`/settings`, a push notification) skips it.

## Goal

After sign-up, one guided, step-by-step setup that a seller **must** finish before reaching the app. When it
ends, the store can actually take an order. Settings stays where answers are changed later; it stops being
where a new seller has to finish setting up.

"Mandatory" means **each step needs a deliberate answer before Next** (a choice, with a sensible default
pre-selected where one exists). It does not mean filling in every field: optional fields stay optional, but
they are asked in the wizard instead of being left for Settings to surface.

## The new steps

Seven steps, each saved on Next through the endpoints the app already uses. Every field below is already
accepted by `PATCH /api/vendor` (see `patchSchema` in `app/api/vendor/route.ts`), so **no new write endpoints**.

| # | Step | Must answer | Optional on the same screen | Saves |
| --- | --- | --- | --- | --- |
| 1 | **What you sell & where**: store type first (it rewords everything after it), city, state | type, city, state | "Describe your business" for Other | as today |
| 2 | **How customers pay**: tick at least one: UPI ID (with the ₹1 QR preview), Pay on delivery, Connect Razorpay | ≥ 1 method (`hasPaymentMethod`) | UPI name | `upiId`, `upiName`, `acceptPayOnDelivery` |
| 3 | **Your menu / products**: type rows, or speak the list here | ≥ 1 item with a price | more rows, up to 10 | `POST /api/menu/bulk` |
| 4 | **How you take orders**: Drops (batches with a cut-off), Order any time from the menu, or both | one of the three | none | `acceptMenuOrders` (+ the step marker, see below) |
| 5 | **Pickup or delivery**: pickup / delivery / both. Then the pickup note, delivery fee, and an optional list of delivery areas | the mode | pickup note, fee, areas | `menuFulfilmentMode`, `menuPickupNote`, `menuDeliveryFeePaise`, `deliveryAreas` |
| 6 | **Contact & trust**: WhatsApp number with its two switches (take orders on WhatsApp, show it on the store), Instagram handle, FSSAI (food stores), phone alerts | nothing required; Next confirms what is on screen | all of it | `whatsappNumber`, `acceptWhatsappOrders`, `showWhatsappOnStore`, `instagramHandle`, `fssaiNumber`, push |
| 7 | **Check & publish**: one summary card per step with "Change" links back, and a store-page preview link | Publish | none | `publishStorefront: true`, `onboardingDone: true` in one PATCH |

Notes on the steps:

- **Step 2, Razorpay** (PR 2): Connect Razorpay leaves the site. The connect link carries `?return=onboarding`,
  a fixed name kept in a cookie beside the OAuth nonce, and the callback sends the seller back to step 2 with
  the usual `?razorpay=<outcome>` (`lib/razorpay-connect.ts`). Never a free URL (open redirect). The ticks on
  screen are saved before leaving. Pasting keys stays in Settings only: it is too much for a first run. The
  connect block shows only when Connect is configured and the plan includes online payments (a trial does).
- **Step 2, defaults** (PR 2): a first visit opens with UPI ticked and pay on delivery not ticked, because
  `acceptPayOnDelivery` defaults to `true` in the database and says nothing about what the seller wants.
- **Step 3, speaking the list** (PR 2): "Speak your whole menu" opens the voice menu builder
  (`POST /api/ai/parse-menu`) inside the step, loaded with `next/dynamic` on tap, so its code stays out of the
  step's first load. It saves its own rows; the step re-reads the menu on `MENU_CHANGED_EVENT`. "Type instead"
  is the tap fallback. Nothing sends the seller to `/menu?voice=1` any more.
- **Step 4 wording**: the choice is described in the store's words (`storeVocabulary()`: "Order from menu"
  vs "Order any time"). Choosing Drops creates nothing. It decides what the done screen offers.
- **Step 5** writes the menu fulfilment fields. Drops keep their own per-drop handover, and `lastDropDefaults`
  should fall back to these answers for a store's first drop so they are not asked again.
- **Step 7, publishing**: Publish is the primary action. A secondary "Finish without publishing" stays for
  sellers who are not ready to go public (see open decision 1). Publishing a store whose only answer in step 4
  is Drops gives the existing "Orders open soon" store page until the first drop opens, which is fine.

Done screen (replaces "Your store is ready"):

- The store link with Copy and Share, and the Instagram bio link (`?src=ig`, as the setup card already does).
- Drops chosen → "Create your first drop" (primary). Menu orders only → "Go to your orders".
- The copy is true now: the store is live (or the screen says plainly that it is not, if they finished
  without publishing).

## Mechanics

**Gate.** Move the "not finished → `/onboarding`" rule out of `/home` alone into the vendor layout's server
render (`getShellContext` in `app/(vendor)/_shell-context.ts`, Node, already calls `requireVendorRole`), so no
deep link skips it. Never in middleware: it needs Postgres. **No exceptions**: setup saves through
`PATCH /api/vendor` and `POST /api/menu/bulk`, which never call `requireActiveBilling`, so even a locked trial
can finish setup and then reach Billing. Push and the service worker are unchanged.

**Who can do it.** Saving needs OWNER (`PATCH /api/vendor`). A MANAGER or CASHIER of an unfinished store gets a
plain "Your store owner is finishing setup" page instead of a form that answers 403 on every Next.

**Resume.** `resumeStep()` works out the step from saved data, but some answers can't be told apart from
defaults (Drops only = `acceptMenuOrders: false`, the default; pay on delivery defaults to `true`). Add
**`Vendor.onboardingStep Int?`**: the highest step done, recorded by a small `PATCH { onboardingStep }` after
each Next or Skip (only ever forward, `progressAfter()`), cleared by the server once `onboardingDone` is set.
This replaces the sessionStorage step note (only the per-tab "speak my menu" choice stays there), so a reload
or another device reopens the right step. It is a schema change: migration in `prisma/migrations/`, `prisma migrate deploy` on
Neon **before** merging.

**Existing stores.** Every existing store already has `onboardingDone: true`, so none is forced back through.
The setup checklist card stays as their path, with its links pointing at the matching Settings sections as
today. Demo stores (`lib/demo-store.ts`) keep `onboardingDone: true`. The demo claim flow should send the new
owner through steps 2 and 7 only, since the fixture fills the rest (see open decision 3).

**One source of truth.** Where a Settings section already has a client form for the same fields (delivery
areas, WhatsApp switches, Instagram, FSSAI), the step renders that component, not a copy, so the validation and
wording can't drift. Shared rules stay in their libs (`isValidUpiId`, `lib/delivery-areas.ts`,
`lib/instagram.ts`, `storeVocabulary()`).

**Checklist after onboarding.** For a store that finished the new flow, the card only has the first drop left (if
Drops was chosen) and the FSSAI reminder. No change to `setupChecklist()` rules is needed: the steps are simply
already done.

## Delivery: four PRs, each shippable alone

1. **Gate + step framework + `onboardingStep`.** Migration, layout gate with its exceptions, the non-owner
   page, `resumeStep()` reading the column, the step list generalised to N steps. Steps stay as today.
2. **Payments and items mandatory.** Step 2 with the three methods (+ Razorpay return to onboarding), step 3 with
   ≥ 1 item and voice inside the step.
3. **Orders, handover, contact.** Steps 4–6, reusing the Settings forms.
4. **Check & publish + done screen.** Step 7, the new done screen, `lastDropDefaults` fallback, Help guide copy.

## Tests

- Unit (`app/(onboarding)/onboarding/onboarding-steps.test.ts`): `resumeStep()` from `onboardingStep`, which step
  is required, which methods satisfy step 2, the step-7 summary per store kind.
- E2E: one new-seller spec that goes through every step on the `mobile` project and ends on a published store that
  takes an order. One spec that a deep link to `/orders` lands on `/onboarding` for an unfinished store
  (`e2e/home-landing.spec.ts`, PR 1). A cashier on an unfinished store sees the waiting page. Registered vendors
  start unfinished, so `signIn()` in `e2e/helpers/vendor.ts` marks setup done through the API and goes on to the
  callback (`finishSetup: false` opts out); existing specs keep testing a set-up store. Add `/onboarding` to
  `e2e/contrast.spec.ts`.
- `e2e/mobile-sweep.spec.ts` gets the new screens (44 px targets).
- Bundle: add `/onboarding` to `perf-budget.json` once PR 2 sets its size, since voice is loaded on demand.

## Decisions

Taken 2026-11-07 on the recommended defaults (the user asked for sensible defaults, recorded here).

1. **Publishing is the main way to finish, not the only one.** Step 7's primary button is "Publish my store"; a quiet
   "Finish without publishing" link stays. Forcing a public store on someone still testing puts test-named items on a
   live page.
2. **Contact & trust is its own step (6).** WhatsApp and Instagram are how this ICP's buyers reach them, and the two
   WhatsApp switches need explaining.
3. **A claimed demo store goes through the whole flow, pre-filled** (PR 4: the claim sets `onboardingDone: false`).
   Each step is one tap to confirm, and the new owner sees what was set up for them. Payment needs a real answer,
   since the claim clears the demo UPI ID.
4. **Existing stores are not sent back through it.** No `setupVersion`; the checklist card covers what they lack.
5. **The gate has no exceptions** (see Mechanics): not Billing, not Help.
6. **Non-owners of an unfinished store** see a waiting screen with Sign out (`app/(onboarding)/layout.tsx`). Today
   nothing creates such staff (sign-up and demo stores make OWNERs only), so this is a guard, not a flow.
