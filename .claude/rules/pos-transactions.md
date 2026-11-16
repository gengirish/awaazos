---
description: Counter sales: transaction write path, receipts, undo, offline outbox, moved from CLAUDE.md
paths: ["app/api/transactions/**","app/api/receipts/**","app/(vendor)/pos/**","app/(vendor)/transactions/**","app/(print)/**","app/r/**","components/pos/**","components/receipts/**","components/transactions/**","lib/pos-*.ts","lib/receipt*.ts","lib/pay-sheet-keys.ts","lib/whatsapp*.ts","lib/qr.ts","workers/**","public/sw.js"]
---

<!-- Generated from .cursor/rules/pos-transactions.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Counter sales: transaction write path

Moved out of CLAUDE.md so it loads only when matching files are in play. CLAUDE.md keeps the cross-cutting rules.

## Transaction write path

`POST /api/transactions` recomputes subtotal/total server-side and rejects mismatches with 400, then
does everything in one `prisma.$transaction`: `billSequence.upsert` (atomic per-`(vendorId, date)`
increment producing `AWZ-YYYYMMDD-NNNN`) → `transaction.create` with nested `orderItems` →
`dailySummary.upsert` → `receipt.create`. WhatsApp enqueue happens **after** commit and its failures
are logged and swallowed — Redis being down must never block a sale.

**Receipts go out via wa.me, not Gupshup.** The POS "Send on WhatsApp" and the transactions
"Resend" fetch text from `GET /api/receipts/message` and open a `wa.me` link
(`receiptWhatsappUrl()` in `lib/whatsapp-message.ts`) in the vendor's own WhatsApp. The Gupshup
path — `lib/whatsapp.ts`, `workers/receipt.worker.ts`, `POST /api/receipts/send`, and the
post-sale enqueue above (only when a `customerPhone` is posted on a plan with `whatsapp: true`) —
is kept but unused by the UI. See TODO.md 1.1 before reviving it.

**Receipt module.** One `ReceiptView` (`lib/receipt.ts`, pure and client-safe) per bill, built by
`lib/receipt-data.ts` from the `RECEIPT_TX_SELECT` allowlist (no customer phone/name/address/UTR,
no vendor phone/email). It is rendered three ways: as WhatsApp text (`formatWhatsAppReceiptMessage`),
as the staff print page `/receipts/[bill]` (58/80 mm thermal or A4: named `@page` rules in
`app/globals.css`, `?autoprint=1`, `?embed=1`), and as the public customer page `/r/[token]`.
`<ReceiptDocument>` is the single layout. `/r/[token]` is keyed on `Receipt.publicToken` (192-bit,
minted at `receipt.create`; older bills get one the first time `GET /api/receipts/message` loads
them) and 404s for an unknown token or an inactive vendor. `VendorSettings.autoPrintReceipt` loads
the print page in a hidden iframe after a POS sale, on desktop only. Settings → Receipts edits the
footer, GSTIN, paper width and auto-print.

**Undo a counter sale** (`lib/pos-undo.ts`): "Mark as paid" commits at once, then the toast and the receipt sheet
offer Undo for 5 s (`POS_UNDO_TOAST_MS`, a UI timer only). Undo is a real revert, not a deferred commit:
`undoSale()` (`lib/pos-outbox.ts`) drops the outbox copy, then `POST /api/transactions/undo { clientRef }` (CASHIER,
`{ vendorId, clientRef }`, never STOREFRONT, within 2 min of the receipt row's `createdAt`, else 409) deletes the row
(items and receipt cascade) and decrements its DailySummary in one `$transaction`. The bill number is not handed
back (it may be printed already), so a day's numbering can have a gap. A cash sale stores what was handed over
(`cashReceivedPaise`, CASH only, ≥ total, else 400) and the server-derived `changeGivenPaise`; a short tender can't be
marked paid. The payment sheet's U / C / Enter shortcuts are `lib/pay-sheet-keys.ts`.

`OrderItem.name` and `priceInPaise` are snapshots, not joins. Renaming or deleting a menu item must
not mutate historical bills.

**Offline counter sales** (`docs/PWA_OFFLINE_PLAN.md`): `/sw.js` (registered on `/pos` load) caches
`/pos` and its chunks; it never intercepts `/api/**`, `/s/**` or non-GET. Every POS checkout goes
through the IndexedDB outbox (`lib/pos-outbox.ts`): saved first, then POSTed with a `clientRef` uuid
(`@@unique([vendorId, clientRef])` — replays return the original bill with 200). If the device write
fails (broken IndexedDB) the sale is POSTed directly; with no answer it is `unsaved`, never queued:
the payment sheet stays open and the next tap replays the same `clientRef`. Queued sales show
"Offline #N" and sync on page load / `online` / tab visible — **never on a timer**. A `deferred` sale
is billed to the IST day in its `clientCreatedAt` (≤ 7 days old, `resolveSaleTime`), and its body
`vendorId` must match the resolved vendor or the route 404s (`requireVendorRole` falls back to the
first membership otherwise). UPI QRs are rendered locally by `lib/qr.ts` — no third-party QR host.
