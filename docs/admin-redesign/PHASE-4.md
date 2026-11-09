# Admin redesign, Phase 4: Bet Board, GTM timeline, activation by city

Branch `feat/admin-bets`, on top of Phases 1 to 3 (PRs #183, #184 and #185, merged).

**This phase has a migration.** `prisma migrate deploy` against Neon must finish before the PR merges, or
`/admin/bets` 500s. Nothing else reads the new tables, so no other page is affected either way.

## What shipped

A new page, **`/admin/bets`** ("Bets and timeline"):
- Platform ADMIN, the same as `/admin/metrics`.
- Linked from the admin nav.
- Read on render only.

It has three sections.

### Bet Board

Each bet has a title, a hypothesis (with what happens if it fails), a metric, a target ("at least" or "at most"
a value), a deadline, a decision (pending / keep / kill) and notes.

**On each card:**
- **Status**: a coloured dot plus words. Green "Target met"; amber "Not met yet" or "No data yet"; red "Deadline
  passed, target not met".
- **The numbers**: the metric's value over the last 7 complete days (a share shows its parts, "5.5% (1 of 18)"),
  "N days left", the decision and the notes.

**Editing:**
- "Edit or decide" opens the same form in place.
- "Add a bet" is at the bottom.
- Delete asks first.

**Order:** undecided bets first, by nearest deadline; then decided bets, most recently changed first.

**Seed bet (in the migration):**
- Voice billing: voice share of paid bills at least 30% by 15/12/2026, else demote voice to a secondary input.
- It has a fixed id and `ON CONFLICT DO NOTHING`, so it can't be inserted twice.
- Its notes say voice share counts only from 09/11/2026 (the Phase 1 till fix), and that storefront orders are in
  the total but never voice.

### GTM timeline

- **Two bar charts**, sales (GMV) per day and paid bills per day, over the 60 complete IST days before today. They
  share one day axis. There are two charts rather than one with two y-axes, because a dual axis misleads.
- **Markers** are numbered dashed lines through both charts, explained in a numbered list below them. The list
  says what each one is, so nothing depends on colour.
  - Typed by an admin: outreach, event, launch, each with a label and an optional note. They are added with "Add
    a marker" and can be deleted.
  - Derived, with nothing stored:
    - days when demo stores were created ("2 demo stores created");
    - days when a store took its first ever paid bill ("First paid bill: A, B and 2 more").
- **Hover**: every day has a full-height hover area naming the day, its sales and its bills.
- **Table**: "Show every day as a table" lists all 60 days, with that day's markers.

### Activation by city

- **The table**: every demo store built so far, how many were claimed, and how many claimed stores then took a
  paid bill, split by city, with a total row.
- **Shares**: each figure is a share of the column before.
- **Order**: cities with more demo stores first, Unknown last.

## Metric definitions

### Bet metrics (`BET_METRICS`, `lib/admin-bets.ts`)

These are the same numbers `/admin/metrics` shows, over the same 7 complete IST days.

| Key | Label | Unit | Value |
|---|---|---|---|
| `voice_share` | Voice share of paid bills | share | voice paid bills ÷ all paid bills |
| `voice_share_counter` | Voice share of counter bills | share | voice paid bills ÷ paid counter bills |
| `active_sellers` | Active sellers | count | sellers with ≥ 1 paid bill |
| `paid_bills_7d` | Paid bills | count | all paid bills |
| `gmv_7d` | Sales (GMV) | paise | sum of paid bills' totals |
| `storefront_paid_share` | Storefront orders paid | share | leak map's paid ÷ placed |
| `instagram_orders_7d` | Orders from Instagram | count | the Instagram card's count |

**Targets are integers in the metric's unit:**
- a share is in basis points (3000 = 30%), typed as "30" or "12.5";
- a count is a whole number;
- money is in paise, typed in rupees.

A share is compared by cross-multiplying (`num × 10 000 ≥ target × den`), so 30 of 100 meets 30% exactly with no
rounding. A share with no denominator yet is "No data yet", which counts as not met.

**Status:**
- **Met**: green, whatever the date.
- **Not met, deadline ahead**: amber. The deadline is an IST calendar day and counts as a whole day: a bet due
  15/12 stays amber until 23:59 IST that day.
- **Not met, deadline passed**: red.

The status always reflects this week's value. A decided bet keeps its colour, and the decision is shown beside it.

### Timeline (`lib/gtm-timeline.ts`)

| Series / marker | Rule |
|---|---|
| Days | the 60 complete IST days before today, oldest first |
| Sales, paid bills | PAID, not sample, real stores, bucketed by IST day of `paidAt` |
| Demo stores | DemoAuditLog `create` rows, by IST day of `createdAt`, grouped per day |
| First paid bill | a real store's earliest PAID non-sample `paidAt` ever, if it falls in the 60 days, grouped per day |
| Admin markers | `AdminTimelineMarker.occurredOn` (an IST date) |

Marker numbers run in date order. On the same day the order is launch, event, outreach, demo stores, first paid
bill.

### Activation (`lib/activation-funnel.ts`)

| Stage | Rule |
|---|---|
| Demo stores | distinct `vendorId` of DemoAuditLog `create` rows, ever, deleted demos included |
| Claimed | a DemoAuditLog `claim` row for that store |
| First paid bill | claimed, and the store has ≥ 1 PAID non-sample bill |

City is `Vendor.city`, grouped at read time:
- trimmed, spaces collapsed, lower-cased, then shown in title case;
- a few old names are mapped (Bangalore → Bengaluru, Bombay → Mumbai, Calcutta → Kolkata, Madras → Chennai,
  Gurgaon → Gurugram, New Delhi → Delhi, Secunderabad → Hyderabad);
- a store with no city, or one the internal API hard-deleted, is Unknown.

## Migration

`prisma/migrations/20261112000000_admin_bets_timeline`:
- **Enums**: `BetComparator`, `BetDecision`, `TimelineMarkerKind`.
- **Tables**: `admin_bets` and `admin_timeline_markers`, each with an index on its date.
- **Data**: the seed bet.
- **Checks**: applied to a fresh local Postgres; `prisma migrate diff --from-migrations … --exit-code` reports no
  difference.
- **No relations**: `createdById` / `updatedById` hold the admin's User id as plain text, so removing an admin
  keeps their bets.

**Before merging:** `npx prisma migrate deploy` with Neon's `DIRECT_URL`.

## API

All are platform ADMIN through `adminRoute`, so anyone else gets 404. Inputs are checked with Zod.

| Route | Body | Answer |
|---|---|---|
| `POST /api/admin/bets` | the whole bet (`betInputSchema`) | 201 `{ data: bet }` |
| `PATCH /api/admin/bets/[id]` | the whole bet again | `{ data: bet }`, 404 `not_found` |
| `DELETE /api/admin/bets/[id]` | | `{ success: true }`, 404 `not_found` |
| `POST /api/admin/timeline-markers` | `{ kind, label, note?, occurredOn }` | 201 `{ data: marker }` |
| `DELETE /api/admin/timeline-markers/[id]` | | `{ success: true }`, 404 `not_found` |

**Where this differs from the repo:** the brief asks for Zod on outputs too. These routes parse their answer
through `betOutputSchema` / `markerOutputSchema` before sending it, and are the first routes in the repo to do
so. The envelope is the repo's (`{ data }`, `{ error, issues }`, `{ success: true }`), not an `ApiResponse<T>`.

Log lines carry the admin's id, the row id and, for a bet update, the decision; never the text.

## Helpers, scripts and files created

- `lib/admin-bets.ts` (pure):
  - metrics: `BET_METRICS`, `BET_METRIC_KEYS`, `isBetMetricKey`, `metricSnapshot`, `meetsTarget`;
  - status: `betStatus`, `daysLeftLabel`;
  - formatting: `formatBps`, `formatTarget`, `formatMetricValue`;
  - target input: `parseTargetInput`, `targetToInput`;
  - dates: `istYmd`, `dateOnlyYmd`, `ymdToDateOnly`, `isRealYmd`;
  - schemas: `betInputSchema`, `betOutputSchema`, `toBetOutput`, `DECISION_LABEL`.
- `lib/gtm-timeline.ts` (pure): `buildTimeline`, `TIMELINE_DAYS`, `MARKER_KIND_LABEL`, `markerInputSchema`,
  `markerOutputSchema`, `toMarkerOutput`.
- `lib/activation-funnel.ts` (pure): `buildActivationFunnel`, `cityKey`, `UNKNOWN_CITY`.
- `lib/admin-bets-server.ts`: `loadBets`, `loadTimeline`, `loadActivation`.
- Page and routes: `app/admin/bets/page.tsx`; `app/api/admin/bets/route.ts` and `[id]/route.ts`;
  `app/api/admin/timeline-markers/route.ts` and `[id]/route.ts`.
- Components (`components/admin/`): `BetBoard.tsx`, `BetForm.tsx` (client), `GtmTimeline.tsx`,
  `TimelineMarkerControls.tsx` (client), `ActivationFunnelTable.tsx`. `AdminNav` gained the link.
- Tests:
  - unit: `lib/__tests__/admin-bets.test.ts`, `gtm-timeline.test.ts`, `activation-funnel.test.ts`;
  - E2E: new `e2e/admin-bets.spec.ts`; `/admin/bets` added to `e2e/admin-access.spec.ts`.
- Local tooling, in the session scratchpad, not committed:
  - `seed-bets.cjs`: three more bets (one in each status), three admin markers, eight demo stores across cities;
  - `shot-bets.cjs`: page facts and screenshots.

  They run on top of Phase 2 and 3's `seed-hb.cjs` and `seed-leak.cjs`.

## Checks run

- Unit: 2,281 passed (full suite), including 27 for this phase.
- Typecheck, lint, `next build` (`/admin/bets` is 9.4 kB, 242 kB first load), bundle budget: pass.
- Migration: applied to a fresh local Postgres, no drift, seed row present.
- E2E, against a local build and Postgres:
  - chromium: `admin-bets` + `admin-access`, 7 passed;
  - mobile: `admin-bets`, 3 passed.
- **On the seeded page:**
  - bet statuses and values are right:
    - Instagram 5 against 10, deadline passed → red;
    - storefront 46.6% (7 of 15) against 40% → green;
    - voice 5.5% (1 of 18) against 30% → amber, 36 days left;
  - 12 markers numbered in date order;
  - activation: Bangalore and Bengaluru merge, each stage is inside the one before, Unknown is last;
  - a bar's hover title reads "08/11/2026: ₹1,000.00, 2 paid bills".
- No sideways scroll at 375 px with an edit form open. The chart's marker numbers don't overlap at 375 px (checked
  by measuring their boxes).

## Screenshots

In the session scratchpad:

| File | Shows |
|---|---|
| `bets-375.png` / `bets-1280.png` | the whole page |
| `bets-375-edit.png` | a bet's edit form open on a phone |
| `bets-375-timeline.png` | the timeline with the day table open |
| `bets-375-chart.png` | the GMV chart's stacked marker numbers |

## Known gaps

- **A bet reads this week, not the deadline week.** After the deadline, the card still shows the current 7 days.
  The value on the deadline day isn't frozen.
- **Activation has no time window.** It counts every demo store ever made, so an old batch weighs as much as last
  week's. It doesn't show time to claim or time to first bill either.
- **The timeline reads every paid bill of the 60 days.** That's fine at today's volume. At hundreds of bills a day
  it should become one grouped SQL query.
- **No edit history.** A bet's change history isn't kept, only who changed it last (`updatedById`).
- **Marker numbers on the chart are estimated, not measured.** Their stacking assumes a ~300 px phone chart. With
  more than 4 markers within a few days the labels may still touch, though the list below is always complete.
- **Deleting a bet can't be undone.** It asks first.

## Assumed, not verified

- ADMIN, not only SUPER_ADMIN, may create and edit bets. The brief says "admin-editable", and the page reads no
  contact details. One line in each route changes it to SUPER_ADMIN.
- Status colour words replace the brief's 🟢 / 🟡 / 🔴, because the design system keeps emoji out of UI
  affordances. The colours are the success, warning and destructive tokens.
- "First paid bill" means the store's first ever, not its first after joining a city or a demo.
- A decided bet keeps showing a live status rather than freezing at its decision.
