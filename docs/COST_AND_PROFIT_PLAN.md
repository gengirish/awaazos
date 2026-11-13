# Cost price, purchases and profit plan

Status: step 1 (cost price) merged 2026-11-12 (#199); step 2 (purchases) built on `feat/stock-purchases`;
steps 3 and 4 not started. Written 2026-11-12.

Why: a clothing seller (House of Kaara) ran her stock in a small app she built for herself before
she came to us. It did three things AwaazOS does not: it kept a **cost price** per dress, a dated
record of every **purchase**, and a report of **profit** and **value of stock left**. Moving her
over without them takes away the report she built the app for. Stock per size, the fourth thing it
did, we already have (`docs/INVENTORY_PLAN.md`, phase 2).

This plan adds the three, plus a one-off import of her data. It builds on the inventory rules in the
header of `lib/inventory.ts` and changes none of them.

## What her app does

One screen, no server; everything is in her browser (localStorage `house_of_kaara_inventory`,
photos in IndexedDB `house_of_kaara_db` / `productImages`).

- A product has a name, category, photo, description, cost price, selling price and a count per size.
  Sizes come from the category: adults M, L, XL, XXL, 3XL; kids frocks 6–12 months to 2–3 years.
- Opening stock is typed in when the product is added. After that the count moves only through
  **Buy** (quantity, at the product's cost price) and **Sell** (quantity, at the price she actually
  took, editable per sale). Sell is refused when it would take the count below zero.
- Every buy and sell is a dated record that keeps the cost price of that moment.
- The report has one row per product and size: opening, bought (quantity and cost), sold (quantity
  and money taken), profit, stock left (quantity and value at cost), with totals for all four amounts.

## What we have and what is missing

| Her app | AwaazOS today |
| --- | --- |
| Stock per size | Yes: `ItemVariant`, per-variant stock, sold online and at the counter |
| Price actually taken per sale | Yes: `OrderItem.priceInPaise` and `discountPaise` are snapshots |
| Buy / restock | Partly: the "received" adjust moves the count but records no cost and no history |
| Cost price | No field anywhere |
| Profit, value of stock left | Not computable without cost |
| Sell refused below zero | Online yes; the counter never refuses (`lib/inventory.ts` rule 5) |
| Size list per category | No: sizes are typed per item |

## Decisions

1. **Cost is optional and private.** `costInPaise` null means "not recorded", and every figure built
   on it leaves that item out instead of treating it as zero. Cost is shown to MANAGER and OWNER only
   (a cashier's menu and POS payloads never carry it), never appears in a public `select`, and never
   enters the voice prompt (`stableMenuJson()` picks its own fields). Kitchens see nothing new unless
   they fill it in.
2. **One cost per item or size: the latest.** No FIFO and no weighted average. Her app works this
   way, and a home seller thinks "this kurti costs me ₹450". A purchase at a new cost updates the
   item's cost; stock left is valued at the current cost.
3. **A sale keeps the cost of its moment.** `OrderItem.costInPaise` is a snapshot written by the
   server when the line is created, like `name` and `priceInPaise`. Changing a cost later never
   rewrites old profit. A `deferred` offline sale takes the cost at sync time.
4. **Profit is derived on read, never stored.** Per line: `totalPaise − discountPaise − costInPaise × qty`,
   over the same orders `DailySummary` credits (paid, not cancelled, not samples). A free gift line
   has no revenue and a cost, so it lowers profit, which is true. Lines without a cost snapshot are
   counted in sales but not in profit, and the report says how many were left out.
5. **A purchase is a record, not a second stock counter.** "Received" still moves `stockQty` through
   `recordStockAdjust` (so `stockCountedAt` stays put, rule 2a); in the same transaction it also
   writes a `StockPurchase` row. Stock left keeps coming from the count and the orders, never from
   summing purchases.
6. **No timers.** The report is read on page render, like `/analytics`.
7. **The counter still never refuses a sale.** Her app refuses below zero; ours shows "Oversold by N"
   because the piece has already left and an offline sale can't be refused later. We keep that and
   tell her at handover.

## Step 1: cost price

Migration (three nullable columns, run on Neon before merge):

- `MenuItem.costInPaise Int?`
- `ItemVariant.costInPaise Int?` (null = the item's cost, like its price)
- `OrderItem.costInPaise Int?` (per unit, snapshot)

Work:

- Item form: "Cost price" beside the price, and per size in the "Sizes or colours" rows. Wording
  through the vocabulary. Rupees in, `rupeesToPaise` at the boundary; 0 to ₹1,00,000 like prices.
- `POST /api/menu`, `PATCH /api/menu/[id]`, `PUT /api/menu/[id]/variants`, `POST /api/menu/bulk`
  accept it from MANAGER and above; a CASHIER sending it is ignored, and CASHIER reads don't return it.
- One statement, `stampOrderCosts` in `lib/item-cost-server.ts`, run right after the bill is created
  in the three places that create order lines: `POST /api/transactions`, `placeMenuOrder`,
  `placeStorefrontOrder`. It covers gift lines and reads only the bill's own store.
- The menu card and the form show the margin for MANAGER and above ("Cost ₹250.00 · Margin ₹349.00").
- As built: a cost of 0 is allowed (a free sample from a supplier); a cashier's rows carry null and a
  cost they send is ignored, not refused, so the rest of their edit still saves.
- Tests: `lib/__tests__/item-cost.test.ts`, `item-cost.db.test.ts` (in `npm run test:drops:db`),
  `e2e/item-cost.spec.ts`. No tenant-isolation case: no new route.

## Step 2: purchases

Migration: one table.

```prisma
model StockPurchase {
  id              String   @id @default(cuid())
  vendorId        String
  menuItemId      String
  variantId       String?
  qty             Int
  unitCostInPaise Int?     // null = cost not recorded for this purchase
  purchasedAt     DateTime @default(now())
  createdByUserId String?
  @@index([vendorId, purchasedAt])
  @@index([menuItemId])
}
```

As built (rules in the header of `lib/stock-purchase.ts`):

- Its own route, not a third shape on the stock route: `POST /api/menu/[id]/purchases`
  `{ lines: [{ qty, variantId? }], costInRupees? }` (MANAGER), so one delivery covers several sizes in one
  save. In one transaction: lock the rows as an order does, move each count up like +n
  (`recordStockAdjust`, so `stockCountedAt` stays put), write one `StockPurchase` per line, and when a cost
  is given make it the latest cost: a size with its own cost takes it, otherwise the item does.
  `GET` on the same path returns the item's last 5 purchases.
- The table also keeps `variantLabel`, so a purchase still names its size after the size is deleted.
- Left blank, the cost on record at that moment is kept on the purchase (it may be none).
- Only tracked stock can be received (409 `stock_not_tracked`); an item with sizes is received by size.
- The item card has "Received stock" for MANAGER and up: a quantity per tracked size and one cost each,
  pre-filled with the current cost. −1 / +1 and "Set count" stay as they are and write no purchase.
- Switching tracking on, or the first "Set count", is opening stock: no purchase row.
- The item form lists the last purchases (date, size, quantity, cost). Deleting an item deletes them.
- Tests: `lib/__tests__/stock-purchase.test.ts`, `stock-purchase.db.test.ts` (in `npm run test:drops:db`),
  `e2e/stock-purchase.spec.ts`, and a case in `e2e/tenant-isolation.spec.ts`.

## Step 3: stock and profit report

A section on `/analytics` (MANAGER, already the gate there), shown when the store has at least one
tracked item. Rules in a new pure `lib/stock-report.ts`, query in `lib/stock-report-server.ts`.

- Period picker: this month, last month, all time (IST months, `lib/billing-period.ts`).
- Four totals: bought, sales, profit, value of stock left (left × current cost, now, whatever the period).
- One row per item, or per size for an item with sizes: bought (quantity / amount), sold (quantity /
  amount), profit, left (quantity / value). Oversold rows show the negative count and a zero value.
- A line under the table when lines were left out of profit for having no cost.
- "Download CSV" from the same rows. No buyer data in it.
- No "opening" column. Her app derives it as left − bought + sold; with recounts and derived stock
  that number means little here, and a period's bought and sold already say what moved.
- Tests: unit for the arithmetic (gift lines, discounts, missing cost, cancelled and sample orders
  left out); one DB test for the query.

Plan gate: none proposed. Decide before building whether profit belongs to Starter and up.

## Step 4: bring her data over

Her app has no export, so two small pieces, both one-off and outside the product:

1. **Export.** A short snippet she pastes into her browser's console on her app's page (or we add
   an "Export" button to her app and she runs it once). It downloads one JSON file: the localStorage
   products plus each photo from IndexedDB as a data URL.
2. **Import.** `npm run import:kaara -- <slug> <file.json>`, a dry run that prints what it would do;
   `--create` writes, `--allow-remote` for Neon. Same shape as `seed:quiche-plans`. Idempotent on
   item name within the store.
   - Product → `MenuItem` through `lib/menu-create.ts` (name, category, description cut to 200,
     price and cost through `rupeesToPaise`).
   - Each size → `ItemVariant` with `stockQty` = her current count, counted now. Sizes at 0 come too.
   - Photo → the normal menu image upload (`lib/blob-image.ts` rules).
   - Her purchase records → `StockPurchase` rows with their own dates and costs.
   - Her past sales are **not** turned into bills: they would mint bill numbers, credit
     `DailySummary` and count toward the plan cap for money that never passed through us. She keeps
     her old report as a CSV the import writes beside the JSON, and our report starts at the import.

Needs steps 1 and 2 merged, and sizes switched on for her store (`ITEM_VARIANTS_ENABLED` is still
off in production until the remaining phase 2 work in `docs/INVENTORY_PLAN.md` lands).

## Later, if she or others ask

- **Saved size lists** ("Adult: M, L, XL, XXL, 3XL"), picked in the item form instead of retyped.
  Until then, "copy sizes from another item" would cover most of it.
- Purchases by voice ("kurti M 10 aaye, 450 each"), with the restock builder already listed in the
  inventory plan.
- Supplier name and a note on a purchase.
- Editing or deleting a wrong purchase. Until then a purchase can't be undone: the seller takes the
  extra pieces off with −1 and corrects the cost in the item form.

## Open questions

1. Is latest cost enough for her, or does she buy the same dress at different costs often enough to
   want an average? Ask her before step 2.
2. Should a purchase at a new cost change the item's cost without asking, or ask each time? Built as:
   it changes it, and the dialog says so under the cost field.
3. Does profit sit behind a plan?
4. Does she want her past sales visible inside AwaazOS at all? If yes, the smallest honest form is
   a "before AwaazOS" total per item on the report, not bills.
5. The folder we read is the code only. Is her live data in the browser she still uses, and is she
   willing to run the export?
