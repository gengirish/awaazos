# Inventory plan

Why: a home-run clothing store sells the same pieces on Instagram, WhatsApp, at the counter and at
exhibitions, and kept selling pieces it no longer had. Kitchens mostly don't need this, so it is
opt-in per item and invisible until switched on.

Rules live in the header of `lib/inventory.ts`; this file is the plan and the reasons.

## Phase 1: stock per product (shipped, #187)

- `MenuItem.stockQty` (null = not tracked), `stockCountedAt`, `lowStockAt`.
- **Left is derived, never decremented**, like a drop's sold count: the seller's count minus units in
  orders that hold stock. A lapsed UPI hold, a cancel and a POS undo give stock back with no write and
  no timer (Neon can sleep).
- Online orders lock the tracked rows (`FOR UPDATE`, id order) and refuse a shortfall
  (`out_of_stock` / `sold_out`). The counter never refuses, so left can go negative ("Oversold by N").
- A drop item is capped by the smaller of its `maxQty` and its product's stock.
- Buyers see "Sold out" and "Only N left" (at or below `lowStockAt`, else 3), never the count above it.

## Phase 1 fixes (this PR)

Two holes in the count arithmetic, both found in review after #187 merged.

1. **−1 / +1 lost stock for good.** An adjust used to record "left ± n" as a fresh count at now, so
   every open order became permanently sold. A UPI hold that then lapsed, or an order cancelled after
   the tap, never gave its stock back. Now an adjust moves `stockQty` by the difference and keeps
   `stockCountedAt`; only "Set count" (and switching tracking on) moves the time. An adjust never takes
   left below 0 and never lifts an oversold item on a decrease (+1 on −2 is −1, as the card shows).
2. **A count could oversell.** A seller counts the shelf, and the shelf still holds pieces packed for
   orders not handed over yet. Those orders were placed before the count, so they stopped counting,
   and the packed pieces were sold twice. Now:
   - A count means everything on the shelf, packed pieces included. The form says so.
   - Left also subtracts storefront orders placed by the count that still hold stock and were not
     handed over by then.
   - `Transaction.deliveredAt` is new, stamped by the one `deliver` action and cleared by `undeliver`.
     It tells "handed over after the count" (still subtracted: it left a shelf the count included)
     from "before" (not on the shelf, not counted). An older DELIVERED row without the stamp counts as
     handed over long ago.
   - "Set count" and "In stock now" pre-fill the shelf (left + set aside, `onShelfCount`), so saving
     the same number twice changes nothing.

Migration `20261114000000_transaction_delivered_at` (one nullable column) must run on Neon before merge.

## Phase 2: sizes and colours

The clothing store's real need: one kurti in S / M / L, each with its own stock. Rules in the header
of `lib/item-variants.ts`. Three PRs:

1. **Room on /menu** (#190, merged): the item form loads on first open; /menu 303.6 → 281.6 kB.
2. **Sizes in the data, the seller's form and the store page** (this PR, behind `ITEM_VARIANTS_ENABLED`):
   - `ItemVariant` under `MenuItem`: label ("M", "Red / M"), optional price, `isAvailable`, its own
     `stockQty` / `stockCountedAt` / `lowStockAt`, `sortOrder`. `OrderItem.variantId` plus the name
     snapshot ("Cotton kurti – M"), so old bills stay right after a rename or delete.
   - The same derived-stock rules per variant; the item keeps no count of its own and reads "Sold out"
     when every variant is.
   - Menu orders: each line names a variant, priced from it; tracked variants are locked and checked.
     Offers treat a variant as its item.
   - Seller: "Sizes or colours" rows in the item form (goods stores, flag on), chips on the menu card.
   - Buyer: a size picker on the store page (up to 5 as options, more as a drop-down), one cart line per
     size.
   - Migration `20261116000000_item_variants` must run on Neon before merge.
3. **Everywhere else**, one PR each:
   - Counter (this step's first PR): a POS tile with sizes opens a size picker, one cart line per size,
     the bill line keeps `variantId` (checked against the vendor's sizes of that item) and takes stock
     from that size. Voice leaves sized items out and asks for a tap. No migration.
   - Next: drops (today an item with sizes
   can't join one), free gifts with sizes (today that offer is skipped), order again (today a sized line
   is not refilled), the packing list grouped by size, and the voice menu builder. Then the flag goes.

## Later

- Low-stock push to the owner when a sale crosses the line (event-driven, never a timer).
- Restock by voice ("kurti M 10 aur aaye") through a forced tool like the menu builder.
- Stock CSV export.
- A movement history (who changed the count, when, why), if sellers ask why a number moved.
