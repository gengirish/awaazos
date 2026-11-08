# Product name and domain

**Status (2026-10-15): proposal, not yet decided.** Positioning the name must carry: orders,
payments and receipts for sellers who run their business on Instagram and WhatsApp (pre-orders,
everyday menu orders and counter sales), home kitchens first. Recommended name **Ordaro**; nothing has been
bought or filed. The code, package and deployment are still `awaazos`. Where this doc and the
code disagree, the code describes what ships.

## Why rename

- "Awaaz" means voice. Voice is one feature (the counter till) of a product that now covers the
  whole selling loop for sellers on Instagram and WhatsApp: pre-orders with a cut-off, everyday
  menu orders, counter sales, UPI and Razorpay payments, receipts on WhatsApp, one orders board.
- Spoken "Awaaz" is written four ways (awaaz, awaz, aawaz, avaaz). The name lives inside a bio
  link, so one spelling matters.
- "OS" reads as enterprise software to a home baker.
- There are no paying customers yet (first trials end 2026-11-09), so this is the cheapest
  moment a rename will ever be.

## What the name has to do

The brand sits in an Instagram bio as a URL (`<domain>/s/<slug>`), on a buyer's UPI screen, and
in word of mouth between sellers. So it must:

1. Be spelled one way when heard.
2. Be two or three syllables, readable in English and across Indian languages.
3. Be neutral about the *category* (bakers today; crochet, candles, jewellery, plants later) and
   about the *channel* (Instagram, WhatsApp, the counter), and not narrower than the product:
   it takes every kind of order, not only pre-orders.
4. Sound global, not like a government scheme or a website builder.
5. Not look like gambling to Instagram's link filter (rules out "slots", which is otherwise the
   sellers' own vocabulary).
6. Have an exact-match .in at least; .com buyable; trademark clear in classes 9, 35, 42, 43.

## Recommendation

| | Name | Why | Domains (registry RDAP, 2026-10-15) |
|---|---|---|---|
| **Pick** | **Ordaro** | Coined, 6 letters, reads as "order" in every Indian language and in English. Covers pre-orders, menu orders and counter sales alike; no meaning to outgrow | ordaro.in, .app, .io free; ordaro.com parked at HugeDomains (buyable) |
| Alt | Spoken For | The idiom for "already claimed", exactly what a capped pre-order is; warmest, premium English. Opaque to a Hindi-first buyer, and it says pre-orders only, not counter sales or receipts | spokenfor.in free; spokenfor.com at HugeDomains |
| Alt | Tinyrun | "A tiny production run": makers' own word for a batch of 20. Pre-order-only, like Spoken For | tinyrun.in, .app, .io free; .com taken, use unknown |

Before buying Ordaro:

1. Trademark search at IP India (public search) and WIPO Global Brand Database for "ordaro",
   classes 9, 35, 42.
2. Register ordaro.in, ordaro.app and ordaro.io the same day. `.app` is a good primary for a PWA;
   keep `.in` for buyers' trust in India.
3. Get the HugeDomains quote for ordaro.com; launch without it, buy it once the first ten sellers
   are live.
4. Say it to three sellers and ask them to spell it back.
5. Check the Instagram handle; `@ordaro.in` or `@ordaroapp` is fine if `@ordaro` is taken.

## Candidates considered and why not

Every row was checked against the registries (NIXI for .in, Verisign for .com, Google for .app,
Identity Digital for .io) on 2026-10-15. "Dormant" = registered, no web server.

| Family | Examples | Verdict |
|---|---|---|
| One-word Hindi kitchen nouns | tokri, pakka, potli, dabba, rasoi, belan, halwai, katori, farmaish, chatori, chakh | All registered on .in and .com, most dormant or on aftermarket landers. Tokri was a funded Pune grocery startup. "Pakka" is a listed packaging company (Chuk tableware), food-adjacent, so unownable. Food-only meaning. |
| Khilao ("feed them") | khilao.in, .app, .co.in free; .com dormant since 2013 | Best food-only name (no collisions found) but fails the category-neutral test. |
| Hindi-English hybrids | batchwala (.in and .com free), pakkaorders, prebookwala, bookmybatch | Category-neutral and ownable, but not global-sounding; "-wala" is playful and masculine. All three are batch-only names; the product also does everyday orders and counter sales, so they would need outgrowing. |
| "-dukaan" compounds | biodukaan, dropdukaan, linkdukaan (free) | Dukaan is a funded competitor with the mark; any X-dukaan borrows their brand. |
| MyDigiStore | mydigistore.in is a live unrelated site; .com registered | Generic, unownable, collides with Digistore24, and "store" puts us against Dukaan/Shopify instead of on the pre-order wedge. |
| Plain English mechanism .coms | orderby, readyby, lastorders, batchwise, dropwise, smallbatch, orderline, dropday, cutoff, preorder, soldout | All .coms registered; several are live businesses (Batchline, Dropwise, Droppa, Lotly) that would also block a mark. |
| Idioms | byfriday (.com for sale), spokenfor (HugeDomains), madeto (.com "Coming Soon"), dibs/bagsy/countmein (all gone) | Spoken For kept as alt. ByFriday hard-codes one cut-off day. |
| "Slots" names | slotsopen.in free | Rejected: gambling look-alike for Instagram's link filter and ad policies. |
| "Drop" names | dropwala, dropkitchen, dropkit | Collides with the KitchenAid-owned Drop app in the kitchen category; "drop" is founder vocabulary, sellers say pre-order / slots / batch. |
| Coined -ly / -zy / -io | batchly, lotly, batchzy, lotzy, batchio, preordr | .coms taken or they sound like every 2021 startup. |

## Rename checklist (when decided)

Not started. When the name is final: `package.json` name, `app/layout.tsx` title and
`appleWebApp.title`, the manifest, `lib/plan-copy.ts` and marketing pages, legal pages, email
sender names, Razorpay merchant display name, WhatsApp receipt text, `lib/help-guide.ts`, Vercel
project and domains, Fly app names (`fly.toml`), Sentry project, and `README.md` /
`ARCHITECTURE.md` / `CLAUDE.md`. Keep `/s/<slug>` URLs working on the old domain with a redirect.
