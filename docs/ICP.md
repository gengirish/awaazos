# Ideal customer profile

**Decided 2026-10-09.** This replaces the street-stall micro-merchant (chai stall, dosa cart, kirana)
that `PITCH.md` and older docs were written for. Where another doc disagrees, this one wins for
positioning; code still wins for behaviour.

## Who

**Instagram-based cloud kitchens.** Home and small commercial kitchens that find customers on
Instagram and sell directly, not through Swiggy or Zomato.

| | |
|---|---|
| Typical seller | Home baker, meal-box kitchen, regional snacks or sweets, desserts. One to three people, often run from home |
| Where demand comes from | Instagram posts, Reels and stories; repeat buyers who follow the account |
| How orders arrive today | DMs and story replies → moved to WhatsApp → UPI screenshot → notebook or spreadsheet |
| How they sell | Batches with a cut-off ("Saturday bakes, order by Fri 9 pm") and/or an everyday menu |
| Volume | Roughly 10–80 orders per batch or day — within the Starter cap of 500 transactions/month |
| Fulfilment | Pickup, or delivery they book themselves (Porter, Rapido, own rider) |
| Payment | UPI to their own ID; some cash on delivery; a few have their own Razorpay account |

## The pain we solve

1. **Orders scattered across DMs.** Nothing tracks who ordered what; items get missed.
2. **"Did they pay?"** Matching UPI screenshots to orders by hand.
3. **Overselling a limited batch.** No stock cap, so they apologise and refund.
4. **Day-of chaos.** Working out how much to cook and who gets what, from chat history.
5. **"Menu?" on repeat.** Answering the same DM with the same price list every week.

## What we already ship for them

| Pain | Feature | Where |
|---|---|---|
| Link in bio | Public storefront `/s/[slug]` (opt-in `publishStorefront`) with the kitchen's own banner and logo | `app/s/[slug]`, `lib/store-image.ts` |
| Batches with a cut-off | Drops: lazy cut-off, capped stock, no overselling | `lib/drops.ts` |
| Everyday menu | Order from menu (`acceptMenuOrders`) | `lib/menu-orders.ts` |
| "Did they pay?" | UPI intent + buyer UTR, pay on delivery, vendor's own Razorpay keys | `lib/storefront-razorpay.ts` |
| Day-of chaos | Orders board, prep sheet (cook list + delivery list), Web Push alerts | `/drops/[id]`, `/drops/[id]/prep`, `lib/push.ts` |
| Posting the batch | WhatsApp share text, link-preview card, **Instagram story image** | `lib/drops-share.ts`, `app/s/[slug]/opengraph-image.tsx`, `lib/drop-story-image.tsx` |
| Building the batch | Voice drop builder ("aaj 20 ragi laddu 150 rupaye…") | `lib/parse-drop.ts` |
| Repeat buyers | Buyer accounts (email magic link), receipt with storefront link | `lib/customer-auth.ts` |

The voice counter POS (`/pos`) still works and stays, but it is a secondary feature for this
customer: most of their orders are remote.

## Plan, in order (revised 2026-10-10)

1. **Validate the ICP.** Get 5–10 Instagram kitchens to each run one real drop. Nothing below is
   proven until that happens.
2. **Instagram in-app browser.** Most buyers open the storefront inside Instagram. Test and fix
   storefront → checkout → UPI app hand-off → WhatsApp hand-off on iOS and Android, and show an
   "Open in browser" hint only where a step fails. Guest checkout needs no sign-in; only the
   buyer's Account page relies on an email link, which loses the session in another browser.
   iPhone UPI payment is PR #35.
3. **Measure Instagram demand.** Count storefront orders that arrive from Instagram (a `?src=ig`
   tag on shared links plus the in-app browser's user agent) on `/admin/metrics`.
4. **Store-level story image** for kitchens that sell from the everyday menu rather than drops.
5. **30-day unlimited trial replaces FREE** (decided 2026-10-09/10): new sign-ups get STARTER
   features for 30 days, then are locked until paid; existing FREE vendors are grandfathered.
   Spec and phases: `docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md` (PR #38).
6. **Delivery hand-off.** Copy or share one order's address and contact for Porter/Rapido from the
   prep sheet.
7. **Pitch.** `PITCH.md` Parts A–F still tell the street-stall story.

Dropped: a separate "DM quick reply". The storefront Share button and the WhatsApp order flow
cover it; revisit if the kitchens in step 1 still paste prices into DMs.

## Not the customer

- Kitchens where Swiggy/Zomato is most of the volume — the aggregator owns ordering and payment.
- Restaurants with dine-in tables and a KOT flow.
- Sellers who need GST invoices with a CGST/SGST split (not built).
- Street stalls and kiranas with hundreds of walk-in sales a day — the counter POS serves them,
  but we no longer build for them first.

## How to use this

When choosing what to build next, ask: does it help an Instagram kitchen take, get paid for, and
deliver a batch of orders with less DM work? If not, it waits.
