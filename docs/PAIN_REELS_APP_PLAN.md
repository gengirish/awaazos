# Pain reels in the app: plan

Status: Phases 1–3 built 2026-11-19 (`/v/<id>` pages and landing row; survey answer; outreach picker). Phase 4 not started.

## What we have

14 pain-point reels, rendered by `npm run pain-reels:render` from `content/pain-reels/reels.ts`: 8 for kitchens,
6 for jewellery. Each is a hook card in the seller's words ("DMs mein orders kho jaate hain?"), a narrated demo
film, and an end card ("Apna store, 30 din free", awaazdo.store). Every one except `jewellery-free-pouch` answers
one survey pain (`OWNER_PAINS` key). The files are local only:
`.claude/worktrees/demo-videos/demo-output/pain-reels/<id>.mp4` and `<id>.cover.jpg` (42 MB as rendered).

Today they reach people only when someone posts them by hand, with text from `content/pain-reels/CAPTIONS.md`.

## Goal

Put each reel where a seller is already telling us about that pain, or looking for an answer to it:

1. **Visitors to the landing page** see the problems they have, then how the product fixes them.
2. **Sellers who fill in `/survey`** see the reel for the pain they ranked first, right after they submit.
3. **Outreach messages** (`/admin/demo-stores`) can carry a link to the reel that fits the lead.
4. **Anyone we send a link to** (WhatsApp, Instagram story or bio) lands on a page that plays the reel and offers
   sign-up, not on a bare `.mp4`.

Out of scope: buyers never see these (they sell AwaazDo, not the seller's store), and nothing auto-plays with sound.

## How the films are served: same as the Help films

Reuse the pattern that already works for `/help` (`lib/help-videos.ts`, `scripts/publish-help-videos.ts`):

- **Hosting:** the existing public Blob store, new folder `pain-reels/`: `<id>.mp4` and `<id>.jpg` (poster from
  `<id>.cover.jpg`). Encoded like the Help films: 720 × 1280, H.264 with the index at the front (`+faststart`),
  96 kbps AAC, poster 540 px wide. Expect about 1.5–2.5 MB per reel, about 30 MB in total.
- **Env:** `PAIN_REEL_BASE_URL` (feature-gated in `lib/env.ts`, optional). When it's unset, every surface below
  shows nothing, so nothing points at a missing file. It's read at build time on static pages, so setting it needs
  a redeploy (same as `HELP_VIDEO_BASE_URL`).
- **Publish:** extend `scripts/publish-help-videos.ts` with a `--set=pain-reels` mode, or factor out its encode and
  upload into `scripts/lib/publish-videos.ts` and add `scripts/publish-pain-reels.ts`. I recommend the second: two
  thin scripts and one encoder. Command: `npm run pain-reels:publish -- --from=<pain-reels folder> --upload`.
- **No database, no timers.** Every surface is static or reads a constant, so Neon is never woken
  (CLAUDE.md "No timers").

## Data: `lib/pain-reels.ts`

A pure, client-safe module like `lib/help-videos.ts`:

- `PAIN_REELS` stays the source of truth in `content/pain-reels/reels.ts`, since the renderer reads it too. Add to
  each entry:
  - `title`: a plain English name ("Orders lost in DMs").
  - `seconds`
  - `lines`: the transcript. Captions are burned into the picture, so a screen reader needs these. Films that are
    also Help films reuse `HELP_VIDEOS[].lines`. The g1–g6 jewellery films need their lines copied from their
    `.srt`.
- `painReelsFor({ kind, pain?, base })` returns resolved `{ id, title, hook, sub, seconds, lines, src, poster }`.
  It returns nothing when the base is unset. `kind` maps `food` → kitchen reels, `goods` → jewellery reels.
- `painReelForPain(pain, kind)` returns the one reel for a survey answer, or null.
- Tests (`lib/__tests__/pain-reels.test.ts`):
  - every `pain` is an `OWNER_PAINS` key or null
  - ids are unique
  - every reel has `lines`
  - the base URL rules match `helpVideoBase`
  - copy names the product through `BRAND_NAME` (the brand test already scans app code)

## Surfaces, in build order

### Phase 1: public watch page and landing section (one PR)

**`/v/[id]`, the reel's own page** (inside the `(marketing)` group, so it uses the marketing header and footer):

- `generateStaticParams` over `PAIN_REELS`. An unknown id gives `notFound()` (a real 404; no `loading.tsx` here).
- A native `<video controls playsinline preload="none" poster=…>`, the hook as the heading, the transcript in a
  `<details>`, and one CTA: "Start your free store" → sign-up, with copy from `TRIAL_THEN_NOTE` and `lib/plan-copy.ts`.
- `generateMetadata`:
  - `og:image` = poster, `og:video` = mp4, `twitter:card` = player, so a WhatsApp or Instagram link previews with
    the cover.
  - Title from the hook plus `BRAND_NAME`.
  - Indexed (it names no person or society).
- Optional `?ref=<code>` passes through to the sign-up link, which is what Phase 4 needs.
- The page carries no JS beyond the marketing chrome. The video is native, so the route stays well inside the
  bundle budget.

**Landing page section "Sound familiar?"** (`components/marketing/PainReels.tsx`, between `HowItWorks` and
`OnlinePayments`):

- A horizontal scroll-snap row of poster cards: hook, sub line, length. Tapping a card opens `/v/<id>`. A plain link,
  so no player JS on `/`, which keeps the page static and inside its 194 kB budget.
- Two rows, "Home kitchens" and "Jewellery and other products", each the reels for that store type. No toggle, so no
  client state.
- Posters `loading="lazy"`, with explicit width and height (no layout shift). Covered by the existing
  `e2e/contrast.spec.ts` axe run on `/`.
- Hidden entirely when `PAIN_REEL_BASE_URL` is unset.

Tests:
- e2e `public.spec.ts`: `/v/orders_scattered` is 200 with a `<video>` and a sign-up link; `/v/nope` is 404.
- The landing section renders when the env is set.
- `mobile-sweep` covers 44 px tap targets on the cards.

### Phase 2: answer the survey with its reel

Built 2026-11-19 (`lib/survey-film.ts`, `components/survey/SurveyFilm.tsx`). Two changes from the sketch below: the
survey asks no store type, so `/survey` shows the kitchen Reel and links the other store's version; and the in-app
Help film is the one the kitchen Reel is cut from (`PainReel.film`), so there is no separate pain → topic table.

`components/survey/OwnerSurveyForm.tsx` replaces the single "Thank you. We read every answer." line:

- **Public `/survey`:** "Thank you. Here's how sellers fix *<their top pain>*" plus the matching reel (inline
  `<video preload="none">`, store type taken from the answers, or kitchen when unknown), plus "Start your free store".
  It shows the seller's own answer back to them and reads nothing new from the server, so nothing leaks. The
  storefront rule says the survey "shows nothing back", so update that line in `.cursor/rules/storefront.mdc`.
- **In-app Settings → Survey:** this seller already uses the product, so offer the Help film for the same job
  instead, when there is one. Pain reels sell sign-up; this seller needs "how do I". Map with a small
  `PAIN_TO_HELP_TOPIC` table.
- No reel for the pain (four pains have none): keep today's line.

### Phase 3: reel links in outreach

`/admin/demo-stores` pipeline (`lib/outreach-message.ts`, `OutreachWhatsApp`, `BulkSendDialog`):

- A "Add a reel" picker under the message, defaulting to the lead's store type (jewellery lead → jewellery reels).
  Picking one appends `https://awaazdo.store/v/<id>` to the editable text. The admin still sends from their own
  WhatsApp; we send nothing ourselves.
- Optional: remember which reel went to which lead in the existing pipeline notes, to see later which hook gets
  replies. Not a new table in this phase.

### Phase 4 (later): sellers share reels to refer

On the "Refer a seller" screen (`components/referrals/ReferralPrompt.tsx` and Settings), a "Share a video" row: each
reel's `/v/<id>?ref=<code>` through the share sheet or wa.me. Only after the referral credit flow is fully live
(see the referral memory notes); otherwise the link promises a reward that isn't paid out yet.

## Rules to keep

- Copy says only what the product does today. The trial and prices come from `TRIAL_DAYS`, `TRIAL_THEN_NOTE` and
  `lib/plan-copy.ts`. "No commission" means UPI only. No profit reel until the report exists
  (`content/pain-reels/CAPTIONS.md` rules).
- Films show demo data only (Amma's Kitchen, Moti Lane). Never publish a film recorded against real stores.
- No auto-play with sound. `preload="none"` everywhere, so a phone on mobile data downloads a reel only when it's
  tapped.
- Re-recording: after a UI change that touches a filmed screen, run record → render → voice → `pain-reels:render` →
  `pain-reels:publish --upload` and `help-videos:publish --upload`. Same URLs, so no redeploy is needed, but Blob
  caches for a day (`max-age=86400`).
- Rule text goes in `.cursor/rules/storefront.mdc` (landing and `/v`, survey) and `admin-growth.mdc` (outreach),
  then `npm run sync:agent-rules`. CLAUDE.md gets nothing new.

## Decisions (2026-11-19)

1. Route: `/v/<id>`, short enough for WhatsApp and bios.
2. The landing row sits right after "How it works": the problem, then the answer.
3. The hooks stay in Hinglish on `/`, as on Instagram, with the English sub line under each.
4. The demo-film tooling (`feat/demo-videos-pilot`) ships as its own PR (#230). Phase 1 needs only the published files.

## Size

| Phase | What | Rough size |
| --- | --- | --- |
| 1 | `lib/pain-reels.ts`, publish script, `/v/[id]`, landing section, tests, upload | 1 PR, about a day |
| 2 | Survey thank-you with reel / Help film | small PR |
| 3 | Reel picker in outreach | small PR |
| 4 | Referral share row | after referral credit is live |
