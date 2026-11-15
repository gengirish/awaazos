# Demo videos from the Playwright suite: plan

Status: proposal (2026-11-15). Nothing here is built yet.

## Goal

Make product demo videos with scripts we can re-run, so a video can be made again whenever the UI changes instead
of being re-shot by hand. The same scenes feed four uses:

| Use | Format | Length |
| --- | --- | --- |
| Instagram Reels / WhatsApp Status for seller outreach (kitchens and jewellery first) | 9:16, 1080×1920, phone | 15–40 s |
| Landing page hero | 16:9, 1920×1080 (phone frame on a background) | 60–90 s |
| Help guide, one per feature (`lib/help-guide.ts` can link them) | 9:16 or 16:9 | 30–60 s |
| Founder outreach: a prospect's own category (bakery, meals, wellness, crafts) | 9:16 | 30 s |

`docs/archive/DEMO_VIDEO.md` (the 60 s YC film) is stale. Use it for shot structure only.

## Principles

1. **Separate from the test suite.** Demo scenes live in `demo/` and match `*.demo.ts`. `npm run e2e` (`testDir: ./e2e`)
   and Vitest (`*.test.ts`) never collect them, so CI time and the test retry rules stay the same.
2. **Reuse, don't fork.** Scenes call the existing helpers (`e2e/helpers/vendor.ts`, `board.ts`, `nav.ts`,
   `billing-db.ts`) for setup through the API. Only what the camera sees is driven through the UI.
3. **Throwaway database only.** The demo config uses the same `globalSetup` (`e2e/global-setup.ts`), so it refuses
   production. Never record against production: real buyer names, phones and addresses would end up in a video.
4. **Production build, not `next dev`.** Record against `npm run build && npm run start` on a free port (3000 is
   taken locally, so use 3100 with `BASE_URL`). That gives no dev indicator, no compile pauses and real speed.
5. **Fake people only.** Buyer names from a fixed cast (Priya, Arjun, Meera…), phones `9199999xxxxx`, addresses in
   made-up localities. No real store, seller or society names.
6. **No paid calls by default.** Voice is fake Web Speech plus a stubbed `parse-*` response (the pattern in
   `e2e/voice-drop.spec.ts`). `DEMO_LIVE_AI=1` uses real Claude for authenticity, and costs money.
7. **Every video is also a test.** When a selector breaks, the scene fails loudly, which tells us the video is out of
   date.

## Architecture

Built in Phase 0 (status: done, 2026-11-15):

```
playwright.demo.config.ts        # testDir demo/scenes, *.demo.ts, workers 1, retries 0, the E2E global setup;
                                 # project "phone": 360 × 640 at DEMO_SCALE (2.5), new headless, scale forced
demo/
  kit/
    director.ts                  # Director: start/stop, say() (caption cue + reading pause), tap() (fingertip
                                 # then tap), type() (human speed), reveal()/pan() (eased scroll), beat()
    overlay.ts                   # in-page fingertip + ripple and the eased pan, added on first use only
    recorder.ts                  # CDP screencast → frames/*.jpg + frames.json (paint times)
  seed/
    cast.ts                      # fake buyers (9199999xxxxx), city
    kitchen.ts                   # seedStore(): a lib/demo-fixture.ts store through the API, photos via
                                 # seedItemPhotos (local DB only), free-item offer
  scenes/
    c1-buyer-order.demo.ts       # the pilot: Instagram bio link → dish sheet → gift → checkout → order page
scripts/demo-videos/render.mjs   # frames → screen.mp4; captions + rounded screen on the store colour → reel.en.mp4;
                                 # .en.srt; poster.jpg
```

Each scene is Playwright first: a broken selector fails the run, so a stale video can't render silently.
Pages are dismissed of the cookie banner and install cards through localStorage in the scene's init script.

**Phase 0 findings**

- Chrome's screencast paints at the browser's real pixel ratio, not the emulated `deviceScaleFactor`: frames came
  back at 360 × 640 until the scale was also forced at launch (`--force-device-scale-factor`). Raw CDP
  screenshots behave the same way; `clip.scale` screenshots are sharp but run at about 4 fps.
- Frame rate on a page that never stops scrolling (new headless): 3× = 1080 × 1920 at ~14 fps, 2.5× = 900 × 1600
  at ~27 fps, 2× = 720 × 1280 at ~37 fps. 2.5× is the default; the 1.2× upscale in render doesn't show.
- Native `<select>` pickers aren't in the screencast: the scene taps the field, picks in code, and the caption
  says what happened.
- The pilot runs in 1.3 min and renders in about 3 min: 58 s of video, 1080 × 1920, 30 fps.

Voice-over (built 2026-11-16, see Decisions):

```
scripts/demo-videos/voice.mjs          # prep: measure captions, flag overlaps; narrate: vo import-srt per Reel
scripts/demo-videos/tts_durations.py   # spoken length per caption, run inside vo's uv environment
```

A full take: `demo:record` → `demo:voice:prep` (record again only if it says so) → `demo:render` → `demo:voice`.
Outputs `demo-output/final/<scene>.reel.en.voice.mp4`; vo's run folders go to `demo-output/vo-runs/`.

Still to build (Phase 1 onwards):

```
demo/
  stubs/
    speech.ts                    # fake SpeechRecognition (lifted from voice-*.spec.ts into one place)
    ai.ts                        # route stubs for /api/ai/parse-order | parse-drop | parse-menu | transcribe
    wa.ts                        # catches wa.me popups; shows the message as a caption instead
    razorpay.ts                  # stubbed Checkout for the "Pay online" beat (never a real payment)
  seed/
    cast.ts                      # fake buyers, riders, addresses
    stores.ts                    # kitchen / bakery / wellness / clothing stores built through the API,
                                 # photos from public/food and public/demo
  scenes/                        # one file per feature below, e.g. 06-buyer-order.demo.ts
  captions/                      # en.json, hi.json per scene (caption text kept out of the code)
scripts/demo-videos/render.mjs   # ffmpeg: webm → mp4, trim, burn captions, split-screen, intro/outro, formats
demo-output/                     # gitignored: raw/, final/, chapters/
```

npm scripts:

```bash
npm run demo:record                       # all scenes, phone + desktop
npm run demo:record -- --grep buyer       # one scene
npm run demo:render                       # raw webm → final mp4s in demo-output/final
npm run demo:render -- --format reel      # 9:16 only
```

### Recording details to settle in Phase 0

- **Size.** Set `video.size` explicitly (the default shrinks the video to fit 800×800). Phone: 390×844 viewport,
  coarse pointer, recorded and scaled to 1080×1920 in render. Desktop: 1280×720 → 1920×1080.
- **Quality.** Playwright writes low-bitrate VP8 webm. If text looks soft at 1080p, switch `recorder.ts` to CDP
  `Page.startScreencast` (Chromium only, JPEG quality 90+, fixed fps) and assemble with ffmpeg. Decide on one pilot
  scene before building more.
- **Pacing.** `slowMo` is global and makes everything slow. Use `beat()` pauses at story points instead and keep
  `slowMo` low (≈80 ms). Type with `pressSequentially({ delay: 60 })`.
- **Time.** `page.clock` only moves the browser clock. Cut-offs, slots and "Today · 5–9 pm" are computed on the server
  from real time, so seed them relative to now (cut-off +2 h, slot tomorrow evening). Record in IST daytime so
  "Today" and "Tomorrow" read naturally.
- **Two actors.** A buyer's phone and the seller's board are two browser contexts recorded at once, put side by side
  by `render.mjs` (ffmpeg `hstack`). The board polls every 6 min, so the scene taps the sync bar's Refresh (or fires
  `PUSH_ARRIVED_EVENT`) on the seller's side right after the buyer places the order.
- **What can't be filmed.** OS push notifications, the native install sheet, the UPI app, WhatsApp itself. Show the
  in-app side and explain the rest with a caption. Don't draw a fake WhatsApp or UPI-app screen: it copies another
  company's UI.

### Render pipeline (`render.mjs`)

1. Trim the blank first frames (the start offset comes from `chapters.json`).
2. Convert to H.264 MP4 (`-crf 18 -pix_fmt yuv420p`, 30 fps), which Instagram, WhatsApp and `<video>` all accept.
3. Burn captions from the scene's SRT (en or hi), or ship the `.srt` beside the file for YouTube.
4. Compose: phone recording inside a device frame on a store-colour background for 16:9; split-screen for two actors.
5. Intro and outro cards (brand from `lib/brand.ts`, so a rename is one constant: see draft PR #203).
6. Optional voice-over and music tracks (licensed or royalty-free only), loudness normalised (`loudnorm`).
7. Write `demo-output/final/<scene>.<format>.<lang>.mp4` plus a poster frame JPEG.

Needs ffmpeg on PATH (or `ffmpeg-static` as a devDependency). Finished videos are hosted on Vercel Blob or YouTube,
never in `public/`, so the deploy stays small. The landing page loads them lazily with a poster
(`docs/PERFORMANCE.md` budget).

## Feature catalogue

Each row is one scene. "Borrow" names the spec whose steps and selectors the scene starts from. Wording follows the
store type (`storeVocabulary()`): scenes marked **K/G** record twice, once as a kitchen ("Menu", "Prep sheet") and once
as a goods store ("Products", "Packing list").

### A. Seller: getting started

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| A1 | Sign up and claim a store link | Sign-up form → store link fills from the name, shows "available" → setup | Phone | none | `store-handle`, `auth-flows` |
| A2 | Step-by-step setup | Ways to get paid → first items → pre-orders and/or menu orders → pickup/delivery → review → Publish | Phone | speech + parse-menu | `onboarding-steps` |
| A3 | Speak your menu **K/G** | "masala chai 15, samosa 20…" → draft rows → fix a price → Save all | Phone | speech + parse-menu | `voice-menu` |
| A4 | Photos and the product page | Add photo → several photos → reorder → open the item sheet as a buyer | Phone | none | `item-photos`, `item-detail-sheet` |
| A5 | Make the store look like yours | Colour, banner, logo, tagline, background tile, Instagram handle, WhatsApp group link | Phone | none | `settings`, `whatsapp-community` |
| A6 | Share to Instagram | `/store` hub → Copy bio link (`?src=ig`) → story image → product link | Phone | none | `store-install`, `item-detail-sheet` |

### B. Seller: taking orders

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| B1 | Speak a pre-order | "aaj ke liye 20 ragi laddu 150…" → filled form → Open orders → Share | Phone | speech + parse-drop | `voice-drop`, `drops` |
| B2 | Order from menu, any time **K/G** | Status pill on → slots → delivery areas with fees | Phone | none | `menu-orders`, `delivery-areas` |
| B3 | Orders board, one day | New → Accept → Mark ready → Picked up; summary line moves; search | Desktop + phone | none | `orders-board`, `orders-declutter` |
| B4 | Check a UPI payment | Buyer's claim + screenshot → "Did ₹X reach your UPI app?" → Yes, received | Split-screen | none | `buyer-paid-claim`, `storefront-upi-pay` |
| B5 | Hand over to a rider | Out for delivery → "Send to Ravi" (caption shows the text) → rider link → Delivered, cash booked | Split-screen | wa | `delivery-riders` |
| B6 | Prep sheet / packing list **K/G** | Drop's prep sheet → print view | Desktop | none | `drops` |
| B7 | Bulk actions | Select 6 orders → Accept all → Mark ready | Desktop | none | `orders-board` |

### C. Buyer journey (the hero film)

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| C1 | From Instagram bio to order **K/G** | Store page → item sheet → size → cart → slot → address → place | Phone | none | `storefront`, `item-variants` |
| C2 | Pay by UPI | UPI button → caption "your UPI app opens" → Payment done → screenshot | Phone | none | `storefront-upi-pay` |
| C3 | Pay online (Razorpay store) | Pay online → stubbed Checkout → "Paid online" | Phone | razorpay | `storefront-razorpay-first` |
| C4 | After the order | Order page stages → "I've received my order" → stars + comment → Order again | Phone | none | `buyer-received`, `order-feedback`, `order-again` |
| C5 | Add the store to the Home Screen | Install prompt on the store page (caption for the native sheet) | Phone | none | `store-install` |
| C6 | Buyer + seller together | C1 on the left, B3's board picking it up on the right | Split-screen | none | C1 + B3 |

### D. Selling more

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| D1 | A sale | "Diwali sale 10% off" → struck-out prices on the store | Phone | none | `offers` |
| D2 | Quantity plan and free gift | "4+ → free bracelet" → cart shows the gift line and the sale it replaced | Phone | none | `offers`, `free-gift-board` |
| D3 | Customer ratings | Buyer rates → card shows stars → Settings → Customer feedback | Split-screen | none | `order-feedback` |
| D4 | Refer a seller | Settings → Refer a seller → link + story → "free months" | Phone | none | `referrals` |
| D5 | Community page | `/c/<society>` lists the stores | Phone | none | `community-pages` |

### E. Goods stores: stock and sizes

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| E1 | Sizes and colours | Kurti with S/M/L → buyer picks M → packing list by size | Phone | `ITEM_VARIANTS_ENABLED=true` on the server | `item-variants` |
| E2 | Stock per product | Set count → "Only 2 left" on the store → sold out | Split-screen | none | `inventory`, `storefront-sold-out-drop` |
| E3 | Received stock and cost price | Received stock with a cost → latest cost on the item | Phone | none | `stock-purchase`, `item-cost` |

### F. Counter (POS)

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| F1 | Bill by voice | Mic → "do samosa aur ek chai" → cart → UPI QR → Mark as paid → bill number | Phone | speech + parse-order | `pos-transaction`, `pos-payment` |
| F2 | Kannada voice | Same in Kannada → cart | Phone | transcribe + parse-order | `pos-ui` |
| F3 | Tap billing, cash and change | Quick-add grid → Cash ₹500 → change shown → Undo within 5 s | Phone | none | `pos-cart`, `pos-payment` |
| F4 | Works offline | `context.setOffline(true)` → "Offline #1" → back online → synced | Phone | none | `pos-offline` |
| F5 | Receipts | Send on WhatsApp (caption) → print view 58 mm → `/r/<token>` | Desktop | wa | `receipts` |

### G. Plans and billing

| # | Scene | Story beats | Device | Stubs | Borrow |
| --- | --- | --- | --- | --- | --- |
| G1 | Trial to Starter | Trial notice → billing page → plans → (stubbed) Checkout → Paid | Desktop | razorpay | `billing-trial`, `razorpay-subscription` |

Prices on screen come from the constants, so a re-record after a price change shows the new ones. Check
`lib/plan-copy.ts` before publishing.

### H. Internal training (not for marketing)

| # | Scene | For | Borrow |
| --- | --- | --- | --- |
| H1 | Build a demo store and send the claim link | Sales interns (`SALES` role) | `admin-demo-pipeline` |
| H2 | The Today queue and follow-ups | Sales interns | `admin-demo-pipeline` |
| H3 | Reading `/admin/metrics` and `/admin/bets` | Admins | `admin-bets` |

These show only seeded demo data. Keep them unlisted.

## Cuts we publish

| Cut | Scenes | Format |
| --- | --- | --- |
| Hero film, kitchen | A3 → B1 → C1 → C2 → B4 → B3 → C4 (≈ 75 s) | 16:9 + 9:16 |
| Hero film, jewellery store | A3(G) → C1(G) → E1 → D2 → E2 → B3 (≈ 75 s) | 16:9 + 9:16 |
| Outreach: kitchen | C1 → B4 → B3, 30 s | 9:16 |
| Outreach: jewellery | C1(G) with colours → E2 → B3, 30 s | 9:16 |
| Reel: "Your Instagram store in 2 minutes" | A1 → A3 → A6 | 9:16 |
| Reel: "Pre-orders by voice" | B1 → C6 | 9:16 |
| Reel: "No more DMs for orders" | C6 | 9:16 |
| Reel: "Know your stock" | E2 | 9:16 |
| Help library | every A–G scene on its own | 9:16 |

Captions in English and Hindi for every cut; Kannada for F2 and the Bengaluru outreach set.

## Phases

| Phase | What | Done when |
| --- | --- | --- |
| **0. Pilot** (1–2 days) | `playwright.demo.config.ts`, `kit/` (cursor, captions, pace, chapters, quiet), `seed/stores.ts` for one kitchen, scene **C1**, `render.mjs` steps 1–3 | One 9:16 MP4 that reads clearly on a phone at full screen; recordVideo vs screencast decided |
| **1. Hero film** (3–4 days) | TTS voice-over, stubs (speech, ai, wa), split-screen, 16:9 frame, intro/outro; scenes A3, B1, B3, B4, C2, C4, C6; the landing hero `<video>` | Kitchen hero film live on the landing page |
| **2. Reels + jewellery** (3 days) | `jewellery` fixture, **K/G** variants, D2, E1, E2, A1, A6 | Kitchen and jewellery outreach cuts plus four reels |
| **3. Help library** (4–5 days) | Remaining A–G scenes, one per Help topic; link from `lib/help-guide.ts` | Every Help topic that has a screen has a video |
| **4. Keep fresh** (1 day) | `demo-videos.yml` GitHub workflow (`workflow_dispatch` only, throwaway Postgres like the E2E jobs), uploads `demo-output/final` as an artifact; a scene list in this doc marking which videos a UI PR touches | Re-recording everything is one button |
| **5. Internal** (optional, 1–2 days) | H1–H3 | Intern onboarding uses them |

No scheduled run in Phase 4: re-record on demand, after UI changes that touch a published scene.

## Risks and decisions

- **Video quality:** settle in Phase 0 before writing more scenes.
- **Voice authenticity:** stubbed AI always "understands" perfectly. A real `DEMO_LIVE_AI=1` run before publishing
  a hero film keeps claims honest (CLAUDE.md voice pipeline: only the transcript and menu go to Claude).
- **Claims on screen:** captions must match what the product does (e.g. "I've paid" doesn't mark an order paid;
  pay-online is the seller's own Razorpay). Review captions against CLAUDE.md before publishing.
- **Brand name:** the rebrand is open (#203). Keep the name in `lib/brand.ts` and the intro/outro cards so a rename
  is a re-render, not a re-shoot.
- **Customer stories:** never show a real seller's store or quote in a video without their written yes
  (`lib/proof-stories.ts` rule).
- **Feature flags:** E1 needs `ITEM_VARIANTS_ENABLED=true` and AI-image beats need `NEXT_PUBLIC_AI_IMAGES_ENABLED=true`
  (plus a fal key, or a stub) on the recording server only.

## Decisions (2026-11-15)

1. **Voice-over is text-to-speech, through our own local `vo` tool** (`D:\codebase\video-pipeline`, Kokoro-82M on
   ONNX Runtime). Nothing leaves the machine and nothing is billed. Built 2026-11-16:
   - Each caption cue (`director.say()`) is also the spoken line, so a cue is one short sentence.
   - `npm run demo:voice:prep` measures every recorded caption with vo's own engine
     (`scripts/demo-videos/tts_durations.py`, run in vo's environment, silence trimmed exactly as `vo synth` does)
     into `demo-output/tts/<voice>.json`, and says whether any line in the take on disk would run into the next.
   - The Director reads that cache while recording: a new caption waits until the previous line has been said
     (+0.3 s), even while taps go on, and `stop()` waits for the last line. Unmeasured captions use 166 wpm.
   - `npm run demo:voice` runs `vo import-srt` on each Reel with its `.srt` (`--pace anchored --no-subtitles`):
     every line starts at its caption's time, the video stream is copied, never re-encoded.
   - **Voice: `hf_beta`**, one of Kokoro's Indian voices reading our English lines through vo's `en-us` path,
     picked by ear on 2026-11-16 from the four Indian voices (`DEMO_VOICE` overrides it). Hindi and Kannada
     narration would need another engine; captions can still be Hindi.
   - Measured on C1: all 9 lines start within 20 ms of their captions, none pushed, voice ends 2 s before the video.
2. **The hero film plays in the landing page hero** (`components/marketing/`): a muted, looping, `playsinline`
   `<video>` with captions burned in, a poster JPEG first, MP4 from Vercel Blob, loaded only after the page is idle,
   so the landing page's first load and the `(marketing)` static layout don't change. A tap unmutes for the voice.
3. **Outreach cuts go first to home Instagram kitchens and jewellery stores.** Kitchens use the `meals` and
   `bakery` fixtures. Jewellery needs a new fixture (`jewellery`: goods store, earrings / bracelets / necklaces,
   colours as sizes, stock, "2+ → free pouch"), added to `lib/demo-fixture.ts` in Phase 2 so outreach demo stores
   get it too.

## Open questions

1. Hindi captions: written by hand or machine-translated and checked by a Hindi speaker?
2. Hindi or Hinglish narration, if wanted later: a real Indian-language engine added to vo (e.g. Sarvam Bulbul:
   cloud, paid per character, caption text only, never PII).
3. Long quiet stretches: C1 has 9–10 s with no voice (the dish sheet, the checkout form). Add a line there, or
   shorten the beats.
