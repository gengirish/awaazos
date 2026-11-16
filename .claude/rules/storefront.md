---
description: Public storefront surface (/s, /r, /d, /c, /api/s, webhooks): rules every public route follows, moved from CLAUDE.md
paths: ["app/s/**","app/r/**","app/d/**","app/c/**","app/(marketing)/**","app/api/s/**","app/api/d/**","app/api/webhooks/**","components/storefront/**","components/marketing/**","components/rider/**","lib/storefront*.ts","lib/store-*.ts","lib/item-photos*.ts","lib/item-detail.ts","lib/instagram.ts","lib/whatsapp-community.ts","lib/community*.ts","lib/customer-auth.ts","lib/proof-stories.ts"]
---

<!-- Generated from .cursor/rules/storefront.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# Public storefront surface (/s

Moved out of CLAUDE.md so it loads only when matching files are in play. CLAUDE.md keeps the cross-cutting rules.

The exception to "every protected handler starts with `requireVendorRole`" is the **public
storefront surface** — unauthenticated, and no longer read-only (buyers place pre-orders):

| Surface | What |
| --- | --- |
| `/s/[slug]` | Menu + open drops + checkout |
| `/s/[slug]/p/[itemId]` | Product link: the store page with that item's detail sheet open, its own title and preview image (`lib/storefront-product.ts`); an item not on sale shows the store with a notice, never a 404 |
| `/s/[slug]/o/[token]` | Buyer's order page (status, UPI pay, "I've paid" claim) |
| `/s/[slug]/account` | Signed-in buyer's own orders/profile |
| `/r/[token]` | Customer receipt page (see "Receipt module"; not gated on `publishStorefront`) |
| `/d/[token]` + `POST /api/d/[token]` | Rider's "Delivered" link (see "Delivery handoff"; not gated on `publishStorefront`) |
| `/survey` + `POST /api/survey` | Public seller survey: collects answers, shows nothing back (see "Owner survey"; no store involved) |
| `/c/[slug]` | Community page: links to the listed stores of one housing society (see "Community pages") |
| `/api/s/**` | Order placement, UTR submit, "I've received my order", order rating, vendor-Razorpay start/verify, buyer magic-link auth |
| `/api/webhooks/razorpay-orders/[vendorId]` | Per-vendor Razorpay webhook (vendor's own secret) |
| `/api/webhooks/razorpay-partner` | Partner-app webhook for "Connect Razorpay" stores (platform secret) |

Rules every one of them follows:

- The store link is `Vendor.slug`, chosen by the owner: the sign-up form's "Store link" field
  (pre-filled from the store name, live availability from `GET /api/auth/store-handle`, public and
  IP-limited) and Settings → Online store → Store link (`PATCH /api/vendor { slug }`, OWNER, 409
  `store_handle_taken`). Rules in `lib/store-handle.ts` (3–40 chars, `[a-z0-9-]`, reserved words);
  a register call without `storeHandle` still gets the random-suffix slug from `lib/store-slug.ts`
  (demo stores, e2e helper). Changing the link retires the old one at once — nothing redirects — and
  the `awz_vendor` cookie (it holds the slug) is re-set by the PATCH response.
- Gated on `VendorSettings.publishStorefront` (default `false`); not opted in → **404, not 403**.
- Prisma `select` is a hand-written allowlist. `Vendor.phone` / `Vendor.email` never appear.
- Store banner and logo (`Vendor.bannerUrl` / `logoUrl`): OWNER-only `POST`/`DELETE /api/vendor/banner`
  and `/api/vendor/logo` (`lib/store-image.ts`), edited in Settings → Online store. Upload rules (4 MB,
  JPEG/PNG/WebP, validate before Blob) are shared with menu photos in `lib/blob-image.ts`; the browser
  shrinks photos first (`lib/image-downscale.ts`). No Blob token → 503. The banner is decorative
  (`alt=""`); without one the header keeps its theme gradient. A background tile
  (`Vendor.backgroundUrl`, `/api/vendor/background`, same rules, seller's own routes only, not demo stores)
  repeats across `/s/[slug]` under a wash of the page colour (`storeBackgroundStyle`, `lib/store-background.ts`).
- Store colour (`VendorSettings.theme`, `lib/store-theme.ts`) and tagline (`VendorSettings.tagline`,
  `lib/store-tagline.ts`) are OWNER settings in Settings → Online store via `PATCH /api/vendor`. The
  tagline is one line under the store name, the link-preview description and a line on the share
  image. `MenuItem.description` (≤ 200 chars, item form) is one line under the item's name. Neither
  reaches the voice prompt (`stableMenuJson()` selects its fields). A goods store (`storeKind() ===
  "goods"`) lists items as a photo gallery (two columns); a kitchen keeps the rows.
- **Item detail sheet** (`components/storefront/ItemDetailSheet.tsx`, plan in `docs/PRODUCT_PAGE_PLAN.md`):
  tapping an item's name or photo, on any list (menu, pre-order, read-only), opens a sheet with the big
  photo (tap → full size), discount-first price, sizes, stock, the whole description, the offers it
  counts toward (`offersForItem`) and how it is handed over and paid for (`lib/item-detail.ts`, from what
  the page already loaded: no new query). It is rendered by the list that owns the cart (`MenuOrder`,
  `DropOrder`), so its Add is the row's stepper; a read-only menu (`ReadOnlyMenuRow`) has no Add. The address
  follows the sheet (`components/storefront/item-detail-url.ts`): a tap pushes `/s/<slug>/p/<menuItemId>` (the item
  id, never `MenuItem.slug`, which a rename changes), Back closes it, and the query string (`src`) is kept both ways.
  The seller's `/menu` card has "Copy link for Instagram" (`?src=ig`) and WhatsApp (`?src=wa`) once the store is published.
- **Several photos per item** (`lib/item-photos.ts`, database side `lib/item-photos-server.ts`): up to 6.
  `MenuItem.imageUrl` stays the cover and is always the first photo; the rest are `MenuItemImage` rows, so the
  POS, voice, receipts and link previews read nothing new. Only the detail sheet shows them, as a swipeable gallery
  (`ItemPhotoGallery`, scroll-snap). The item form saves each change at once (`GET`/`POST /api/menu/[id]/images`,
  `DELETE …/images/[imageId]` with `cover` for the cover, `PUT …/images/order`, CASHIER, compound scope); every
  change rewrites the whole list under a row lock on the item, and removing the cover moves the next photo up.
- The vendor's WhatsApp number reaches a public page only through `buyerWhatsappNumber()`
  (`lib/storefront-order.ts`): `VendorSettings.whatsappNumber`, and only once the vendor opts in
  with `acceptWhatsappOrders` (default `false`; Settings → Online orders). A saved number is not
  consent — onboarding pre-fills it from the sign-up phone.
- The `/s/[slug]` header has two contact links. WhatsApp goes through `storeWhatsappNumber()`
  (same file) and its own opt-in, `showWhatsappOnStore` (default `false`) — every visitor sees it,
  not only buyers, so `acceptWhatsappOrders` does not imply it. Instagram is
  `VendorSettings.instagramHandle` (Settings → Online store), stored bare and linked only through
  `instagramProfileUrl()` (`lib/instagram.ts`); saving a handle publishes it.
- The seller's own WhatsApp group invite or channel (`VendorSettings.whatsappCommunityUrl`, Settings → Online
  store) shows as "Join our WhatsApp group" / "Follow our WhatsApp channel" in the `/s/[slug]` header and on the
  buyer's order page. Only `chat.whatsapp.com/<code>` and `whatsapp.com/channel/<id>` are accepted, stored
  canonical and rendered only through `whatsappCommunityLink()` (`lib/whatsapp-community.ts`). Buyers join it
  themselves: we never send to it, so there is no bulk messaging and no buyer number leaves our database.
- Order pages are keyed on `Transaction.orderToken` alone (192-bit random, `generateOrderToken()`),
  always looked up together with the slug's `vendorId`. Never expose or accept a transaction `id`.
- Every write is IP rate-limited (`makeLimiter` in `lib/ratelimit.ts`; buyer login also per-email).
- Each store installs as **its own app** for buyers (`lib/store-app.ts`): `app/s/[slug]/layout.tsx` swaps the root
  (seller) manifest for `/s/<slug>/manifest.webmanifest` (`id`/`scope`/`start_url` = `/s/<slug>`, store name and
  colour) and icons from `/s/<slug>/app-icon/<180|192|512>`, both behind the publish gate. `StoreInstall` (store page
  and order page, not demo stores) is a view over `useInstallPrompt`, with its own per-store close; inside Instagram on
  Android it offers "Open in Chrome". Never link the root manifest from `/s/**`: buyers would install the seller app.
- No `loading.tsx` under `app/s` or `app/r`: it streams the page, so `notFound()` would answer 200
  instead of 404. `not-found.tsx` / `error.tsx` there read no data and say the same thing for every miss.
- The buyer's device remembers recent orders in localStorage (`components/storefront/recent-orders.ts`:
  token, bill number, date — never PII). The order page refreshes on tab-visible / `pageshow` and a
  "Check for update" button, never on a timer.
- No buyer PII (phone, name, address, UTR, email) in logs, Sentry or error bodies.
- The order webhook can't verify HMAC before *any* DB read — the secret is per vendor — so it
  reads exactly one column (the encrypted webhook secret) first, and nothing else until verified.
  Unknown vendor and bad signature are indistinguishable (both 400).

## Community pages (`/c/[slug]`)

One public page per housing society ("SDG Home Kitchens") linking to the stores of the home kitchens
living there. Rules in `lib/community.ts` (read its header), queries in `lib/community-server.ts`.
A directory, not a marketplace: no cross-store cart, search, ranking or reviews; every card links to
`/s/<slug>`. A platform ADMIN creates the page and invites stores on `/admin/communities`
(`/api/admin/communities/**`); an invite lists nothing until the store's OWNER taps Join in
Settings → Online store (`POST` / `DELETE /api/vendor/communities/[id]`, own row only, else 404).
The page shows a store only while it is accepted, active, `publishStorefront` and not `isDemo`, with
the storefront header allowlist (name, type, city, logo, slug). Pre-order state comes from the drops'
times on each render — no timers. `noindex`: it names a residential society.

## Landing page (`/`)

`components/marketing/`. Prices and the "from ₹X" anchor come from `lib/plan-copy.ts` (`TRIAL_THEN_NOTE`), never a
literal. Customer stories come from `lib/proof-stories.ts` and render only with `permission: true` (the owner agreed in
writing). The WhatsApp button needs `NEXT_PUBLIC_SUPPORT_WHATSAPP` (build time). `e2e/contrast.spec.ts` runs axe's
contrast rule here, on a store page and on checkout. The `(marketing)` layout must stay static.
