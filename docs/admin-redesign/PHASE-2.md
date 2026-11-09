# Admin redesign, Phase 2: seller heartbeat

Branch `feat/admin-heartbeat`, on top of Phase 1 (PR #183, merged).

## What shipped

A **Seller heartbeat** section at the bottom of `/admin/metrics`, with one row per live store:

- store name and link
- a 14-day sparkline of paid bills per day
- last paid ("Paid today", "Last paid 9 days ago", "Never paid")
- 7-day sales, and 7-day paid bills with last week's count beside it
- voice share
- a churn-risk badge

Rows are sorted riskiest first. Chips filter by badge (All / At risk / Watch / New / Healthy), each with a
count. The filter is a link (`?badge=at_risk`), so it needs no client code and can be bookmarked.

**Nudge on WhatsApp** (SUPER_ADMIN only):
- A row expands to the existing editable-message component (`OutreachWhatsApp`), prefilled from a text
  template, and opens a `wa.me` link to the store's WhatsApp number (or its sign-up phone).
- Nothing is sent from the server.
- A plain ADMIN sees the grid without the button, and the query doesn't read phone numbers at all. That
  matches the rule that owner contacts appear only to SUPER_ADMIN (`/admin/vendors`).

The **copy lives in `content/admin-nudges/*.txt`**, with variables `{firstName}`, `{senderName}`,
`{storeName}`, `{storeUrl}` and `{daysIdle}`. The README there explains each file. Editing the copy needs a
commit and deploy but no code. A test fails if a template is missing or uses a variable that doesn't exist.

The sparkline is inline SVG (`components/admin/Sparkline.tsx`), with no chart library and no client JS. An
idle day is a faint 1 px tick, so a quiet stretch reads as quiet, not missing.

## Metric definitions

A **seller** is a `Vendor` with `isDemo = false` and `isActive = true`, whether or not setup is finished.
Bills are `paymentStatus = PAID` and `isSample = false`. Days are IST calendar days. "Today" is the IST day
of the page load.

| Field | Formula |
|---|---|
| Sparkline | PAID bills per IST day by `paidAt`, the 14 complete days before today (`[istDayStart(14), istDayStart(0))`), oldest first |
| Paid bills, 7 days | the last 7 of those days |
| Was (last week) | the first 7 of those days |
| Sales, 7 days | `SUM(totalPaise)` over the last 7 days |
| Voice share | `source = VOICE` ÷ paid bills over the last 7 days; "–" with none |
| Days idle | IST day of today − IST day of the store's latest paid bill at any time, today included; null if never paid |
| Age | IST day of today − IST day of `Vendor.createdAt` |

### Badges

Badges are checked in this order, first match wins. Thresholds are in `ADMIN_METRICS_CONFIG.heartbeat`.

1. **New**: age < 14 days, whatever the activity.
2. **At risk**: never paid, **or** idle ≥ 7 days, **or** this week's bills ≤ 50% of last week's when last
   week had ≥ 4.
3. **Watch**: idle 3 to 6 days.
4. **Healthy**: idle 0 to 2 days.

Sort order: badge (At risk, Watch, New, Healthy), then longest idle (never paid first), then smaller 7-day
sales, then name.

## Migrations

None.

## Helpers and files created

- `lib/seller-heartbeat.ts` (pure): `buildHeartbeat`, `heartbeatBadge`, `compareByRisk`, `istDayNumber`,
  `parseBadgeFilter`, `countByBadge`, `nudgeTemplateKey`, `fillNudgeTemplate`.
- `lib/seller-heartbeat-server.ts`: `loadSellerHeartbeat`, `loadNudgeTemplates`, `nudgeMessageFor`.
- `components/admin/SellerHeartbeat.tsx` and `components/admin/Sparkline.tsx`.
- `content/admin-nudges/` with five templates and a README.
- `ADMIN_METRICS_CONFIG.heartbeat` thresholds.
- `next.config.mjs`: `outputFileTracingIncludes` so the template files ship in the `/admin/metrics`
  serverless bundle.

## Screenshots

These are in the session scratchpad, from `next start` on a local Postgres. The seed has six stores: a
pottery studio, a tailor, a cloud kitchen, a bakery, a candle maker and a wellness store, one for each badge
case.

| File | Shows |
|---|---|
| `heartbeat-375.png` | the page at 375 px |
| `heartbeat-1280.png` | the page at 1280 px |
| `heartbeat-375-filter.png` | the At risk filter |
| `heartbeat-375-nudge.png` | a Nudge expanded: `wa.me/919812345678?text=…`, with the decoded text matching the textarea |
| `heartbeat-375-admin.png` | a plain ADMIN: the grid shows, with no Nudge |

At 375 px, `scrollWidth` is 375 in every state.

Two changes came after these shots:
- rows sit two to a line from `lg`, because full-width rows at 1280 px were sparse;
- "1 paid bill" is now singular on the Today card.

Local tooling, in the scratchpad: `pg2.mjs`, `seed-hb.cjs`, `shot-hb.cjs`.

## Tests

`lib/__tests__/seller-heartbeat.test.ts` covers:
- 0, 1 and 50 sellers;
- IST day edges (23:59:59.999 against 00:00 IST, a bill today, a bill a day before the window);
- every badge threshold, including the 4-bill floor on the drop rule;
- the risk sort;
- the badge filter;
- template filling, and every shipped template file.

## Known gaps

- Inactive stores (`isActive = false`) are left out, so a store an admin deactivated drops off the grid.
- "Never paid" counts a store from sign-up, so test accounts more than 14 days old show as At risk.
  `/admin/vendors` is still where stores are deactivated.
- The admin's sends aren't recorded. The demo pipeline logs its nudges; this grid does not.
- The query reads every PAID bill of the 14 days. It is fine at 50 stores; with many more, a
  `[vendorId, paidAt]` index and a grouped query would be needed.

## Assumed, not verified

- New takes precedence over At risk (from DISCOVERY.md §6).
- The template's sign-off uses the signed-in admin's first name (`{senderName}`), with "the team" if the
  account has no name.
