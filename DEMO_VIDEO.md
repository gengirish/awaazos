# AwaazOS — 60-Second YC Demo Video Storyboard

> **Goal:** A 60-second video that gets a YC partner to open the live URL within 10 seconds of finishing it. Founder face for credibility, real Hindi voice command for proof, real UPI QR + WhatsApp receipt for "this actually works."
>
> **Hard rules (YC):** ≤ 60 seconds. Founder must appear on camera in the first 5–7s. Show the product working — not slides, not animations. Real device, real screen recording.

---

## TL;DR — what to shoot, in what order

| # | Time | Shot | What's on screen | What you say |
| - | ---- | ---- | ---------------- | ------------ |
| 1 | 0:00–0:07 | **Founder selfie, talking head** | You, framed waist-up, in front of a real chai stall (or a clean wall + chai cup on table) | "I'm Girish. India has 60 million micro-merchants. Zero of them want a typing-based POS." |
| 2 | 0:07–0:15 | **B-roll, real chai stall** | Owner taking cash, paper bill book, kids in queue | "Right now, this is their stack. Paper, memory, dispute." |
| 3 | 0:15–0:25 | **Phone screen recording — POS open** | AwaazOS POS screen, mic button pulsing | (silent — wait for product audio) **You say in Hindi:** *"Do special chai, ek aloo samosa, ek mirchi bajji."* |
| 4 | 0:25–0:33 | **Phone screen — cart fills in real time** | Items appear in cart with prices, total = ₹70 | (let the UI sound do the work) Caption: *2 chai · 1 samosa · 1 mirchi · ₹70* |
| 5 | 0:33–0:42 | **Phone screen — UPI QR modal** | Big crisp UPI QR with ₹70 amount, "Pay via PhonePe / GPay / Paytm" | "Tap. UPI QR. Customer pays. Zero MDR." |
| 6 | 0:42–0:50 | **Phone screen — WhatsApp receipt** | WhatsApp chat showing the AWZ-bill receipt landing | "Receipt on WhatsApp. AWZ bill number. GST-ready. No app install." |
| 7 | 0:50–0:55 | **Cut back to founder, talking head** | Same chai-stall framing | "All in 22 Indian languages. Live today at awaazos.vercel.app." |
| 8 | 0:55–1:00 | **Lock-frame — product + URL** | AwaazOS logo, URL, *YC W27 application*, founder LinkedIn QR | "Bol. Bill. Becho." |

**Total spoken word count:** ~120 words → 130 wpm (comfortable Indian English pace, leaves breathing room)
**Total scenes:** 8 · **Cuts:** 7 · **Music:** subtle Indian-coded ambient (royalty-free, ducked under VO)

---

## Detailed shot list with full script

### Scene 1 — Hook (0:00 – 0:07)
- **Shot:** Founder selfie, mid-shot, eye-line directly into lens. Soft natural light from window-left.
- **Background:** Real chai stall in Hyderabad if possible. Fallback: clean off-white wall + chai glass on a wooden table in foreground.
- **Wardrobe:** Simple solid-colour kurta or plain T-shirt. No logos. No patterns that strobe on camera.
- **Voiceover (verbatim):**
  > "I'm Girish. India has 60 million micro-merchants. **Zero** of them want a typing-based POS."
- **On-screen lower-third caption (0:01–0:06):**
  `Girish Hiremath · Founder, AwaazOS · IntelliForge AI · Hyderabad`
- **Audio:** Pure VO. No music yet.
- **Cut:** Hard cut to scene 2 on the word "POS."

### Scene 2 — Problem (0:07 – 0:15)
- **Shot:** 8 seconds of B-roll. Three quick beats:
  1. Hand counting cash on a glass counter (~2.5s)
  2. Pen scratching a number into a tattered paper bill book (~2.5s)
  3. A vendor's mid-shot of him simultaneously pouring chai and shouting an order (~3s)
- **Voiceover:**
  > "Right now, this is their stack. **Paper. Memory. Dispute.**"
- **On-screen text (0:11–0:14):**
  `₹400–₹800 lost per day to memory disputes`
- **Audio:** VO + faint chai-stall ambience (clinking glasses, distant Hindi chatter). Music gently fades in around 0:13.
- **Cut:** Hard cut to scene 3 on the word "dispute."

### Scene 3 — Voice command (0:15 – 0:25)
- **Shot:** Phone screen recording. Open the AwaazOS POS at `/pos`. Make sure cart is empty. Mic button visible and pulsing the brand red.
- **Action:**
  1. Tap the big circular **🎙 Bolo** button (0:16)
  2. Recording state visible — waveform animating (0:16–0:23)
  3. Hindi voice command (live audio, NOT VO):
     > **"Do special chai, ek aloo samosa, ek mirchi bajji."**
  4. Release / auto-stop. Loading spinner for ~0.8s.
- **Voiceover:** None. Let the product audio breathe. This is the *whole* demo.
- **On-screen subtitle (0:17–0:24):**
  `🎙 "Do special chai, ek aloo samosa, ek mirchi bajji."`
  `(2 special tea, 1 potato samosa, 1 chilli fritter)`
- **Audio:** Live voice + UI mic-tone + the soft "thwip" of waveform. Background music ducks here.
- **Cut:** Smooth cut on the loading-spinner-to-cart-render transition.

### Scene 4 — Cart fills in (0:25 – 0:33)
- **Shot:** Phone screen recording continues. Watch the cart populate one item at a time with a 200ms stagger so the viewer can see the AI parsing happened (use the staggered animation that's already in `OrderCart.tsx`).
- **Action:**
  - `Special Chai × 2 — ₹40` slides in
  - `Aloo Samosa × 1 — ₹15` slides in
  - `Mirchi Bajji × 1 — ₹15` slides in
  - Total flips to **₹70.00** in big rupee glyph
- **Voiceover:** Whisper-paced single line:
  > "Two-second NLU. Hindi, Telugu, Kannada — twenty-two languages."
- **On-screen text (0:30–0:33):**
  `Powered by Sarvam Saaras v2 + Claude Haiku 4.5`
- **Audio:** Subtle item-add chime per row. Music gently lifts.
- **Cut:** Tap-zoom into the bright **Generate UPI QR** button.

### Scene 5 — UPI QR (0:33 – 0:42)
- **Shot:** Phone screen, UPI QR modal opens full-screen.
- **Action:**
  - Big QR rendering with `₹70.00` overlaid below it
  - "Scan with PhonePe / GPay / Paytm" text under
  - Show a second customer phone (real or stand-in) raising up to scan it (use a 2nd device, or animate scan ring overlay)
  - Modal flips to **"Payment received ✓"** with green checkmark
- **Voiceover:**
  > "Tap. UPI QR. Customer pays. **Zero MDR.**"
- **On-screen text (0:38–0:42):**
  `Razorpay UPI · 0% MDR · Settles in 24h`
- **Audio:** Camera-shutter-style "scan" tick, then a soft "ka-ching" chime on payment receipt.
- **Cut:** Slide-up transition to WhatsApp chat.

### Scene 6 — WhatsApp receipt (0:42 – 0:50)
- **Shot:** Phone screen, WhatsApp chat with the customer's number. The receipt message lands in real-time as a green outgoing bubble.
- **Action:** Receipt content visible:
  ```
  AwaazOS · AWZ-20260423-0042
  Special Chai × 2  ₹40
  Aloo Samosa × 1   ₹15
  Mirchi Bajji × 1  ₹15
  ─────────────────
  Total: ₹70.00
  Paid via UPI · Thank you 🙏
  ```
- **Voiceover:**
  > "Receipt on WhatsApp. AWZ bill number. GST-ready. **No app install for the customer.**"
- **On-screen text (0:46–0:50):**
  `Gupshup WhatsApp BAPI · ₹0.30/msg`
- **Audio:** Real WhatsApp message-sent sound (the iconic "swoosh"). Music lifts to climax.
- **Cut:** Hard cut back to founder.

### Scene 7 — Founder close (0:50 – 0:55)
- **Shot:** Same framing as scene 1 — visual continuity matters.
- **Voiceover:**
  > "All in 22 Indian languages. Production-deployed today. **awaazos.vercel.app**."
- **On-screen text (0:51–0:55):**
  `🇮🇳 Live · 51 unit tests · 38 E2E tests · Vercel + Fly.io`
- **Audio:** VO + music at full level.

### Scene 8 — Lock frame (0:55 – 1:00)
- **Shot:** Static end card. 5 full seconds — long enough for someone to screenshot.
- **Visual layout:**
  ```
  ┌────────────────────────────────────────┐
  │                                        │
  │      🇮🇳 AwaazOS                        │
  │      Bol. Bill. Becho.                 │
  │                                        │
  │      awaazos.vercel.app                │
  │      github.com/gengirish/awaazos      │
  │                                        │
  │      [QR to LinkedIn]   YC W27         │
  │                                        │
  │      Built by IntelliForge AI          │
  │      Aligned with Bharat AI Mission    │
  └────────────────────────────────────────┘
  ```
- **Voiceover:**
  > "**Bol. Bill. Becho.**"
- **Audio:** Music resolves on a soft chord. 1s silence at the very end (so YouTube's autoplay-next doesn't crash the moment).

---

## Production checklist

### Pre-production
- [ ] Pick a **real** Hyderabad chai stall — ask the owner for 30 minutes in exchange for ₹500 + a free meal. Get a quick verbal "you can film here" on record.
- [ ] **Two phones**: one for screen recording (the "POS phone"), one for filming the founder + B-roll.
- [ ] Charge both phones to 100%, free up 5GB+ on each.
- [ ] Pre-load AwaazOS on the POS phone with **Special Chai**, **Aloo Samosa**, **Mirchi Bajji** menu items at ₹20 / ₹15 / ₹15 — these prices make the math (₹70) memorable.
- [ ] Pre-create a fake-but-real customer WhatsApp number to receive the receipt (use your own second number).
- [ ] Sign in to AwaazOS as a vendor with `STARTER` plan unlocked (Sarvam STT requires it).

### Equipment
- [ ] Any iPhone 13+ or recent Android with 4K rear camera. **Do NOT use front camera** for the founder shot — quality drops.
- [ ] **Tripod or gimbal** for the talking-head shots (founder selfie scenes).
- [ ] **Lavalier mic** clipped to your kurta — phone-built-in audio is not acceptable for YC. ([Boya M1, ₹600 on Amazon India](https://www.amazon.in/) is enough.)
- [ ] **Reflector or white sheet** for fill-light if shooting indoors.
- [ ] Notebook with the Hindi script written in Devanagari + Roman, so you can do clean retakes.

### Recording
- [ ] **Shoot horizontal 16:9 at 4K, 30fps.** Crop to vertical 9:16 in editing for the LinkedIn / Twitter cut. Never shoot vertical natively — kills repurposability.
- [ ] **Record screen at 1080p minimum.** On iOS: Settings → Control Centre → add Screen Recording → record at the highest bitrate. On Android: use `adb screenrecord --bit-rate 8000000`.
- [ ] **Record screen audio separately** — the iOS/Android screen recorder picks up the system speaker which sounds tinny. Better: capture the live Hindi voice with the lavalier and overlay later.
- [ ] **Do at least 5 takes** of the Hindi voice command. Use the sharpest pronunciation in the final cut.
- [ ] Verify the AwaazOS demo POS responds in <2.5 seconds for the entire `voice → cart` flow before you start filming. Re-warm the Vercel route once before the take so cold-start doesn't show.

### Editing
- [ ] **Edit in:** DaVinci Resolve (free, professional) or CapCut Desktop (faster, free).
- [ ] Cut to **exactly 60 seconds**. Not 61. Not 59. YC partners pause the timer.
- [ ] **Captions on every spoken line.** ~80% of YC partners watch with sound off the first time.
- [ ] **Color grade:** push warmth +5, saturation +10. Indian street scenes need the warmth.
- [ ] **Music:** royalty-free Indian ambient. Recommended: [PixelBay "India Sunrise"](https://pixabay.com/music/) or [Uppbeat "Bharat"](https://uppbeat.io/). Duck to -18 LUFS under any VO.
- [ ] **Loudness:** master at -14 LUFS (YouTube standard) so it doesn't blow out a partner's headphones.
- [ ] **End card freeze:** 5 full seconds with the URL. Long enough to screenshot.

### Export & deliver
| Cut | Resolution | Aspect | Use for |
| --- | ---------- | ------ | ------- |
| **Master** | 3840 × 2160 | 16:9 | Archive + YouTube hero |
| **YC application upload** | 1920 × 1080 | 16:9 | YC application form |
| **Twitter / X** | 1280 × 720 | 16:9 | Founder timeline post |
| **LinkedIn / Instagram** | 1080 × 1920 | 9:16 | Founder LinkedIn post |
| **WhatsApp** | 720 × 1280 | 9:16 | DM to YC partners + warm intros |

---

## Hosting & embeds

### Where to host
1. **Primary:** YouTube unlisted. Gives a clean shareable URL + auto-captions + analytics. Embed-friendly.
2. **Mirror:** Loom (or Vimeo). Loom is preferred by some YC partners because the open-rate analytics are visible.
3. **Backup:** Direct MP4 in `/public/demo.mp4` of this repo so the README can fall back to a native video element if YouTube is blocked in a partner's network.

### Naming & URL convention
- YouTube title: `AwaazOS — Voice POS for India's 60M micro-merchants (60s demo)`
- YouTube description (first line): `Live demo of AwaazOS — voice-first POS in 22 Indian languages. Try it: https://awaazos.vercel.app`
- Loom title: `AwaazOS · YC W27 · 60s product demo`

### README embed snippet (drop in once URL exists)
```markdown
## 🎬 60-Second Demo

[![AwaazOS demo](https://img.youtube.com/vi/<VIDEO_ID>/maxresdefault.jpg)](https://youtu.be/<VIDEO_ID>)

> Voice command in Hindi → cart fills in → UPI QR → WhatsApp receipt. 60 seconds, end-to-end, on a real phone.
```

### PITCH.md embed snippet
```markdown
> **▶ Watch the 60s demo:** https://youtu.be/<VIDEO_ID>
```

---

## Variants (record once, edit many)

- **30-second cut** — drop scenes 2 + 4 + the second half of 6. Keeps founder + voice command + UPI QR + URL. For Twitter/X and Instagram Reels.
- **90-second extended cut** — adds a 15s "why now" slide (Sarvam crossing the bar + UPI 14B txn/mo + WhatsApp BAPI ₹0.30) and an extra 15s of vendor reaction shots. For YC application's longer-form upload field, founder LinkedIn pinned post, and IntelliForge AI website hero.
- **Vertical 9:16 cut** — same scenes, recropped. For LinkedIn / Instagram. Captions baked in.

---

## Post-publish checklist

- [ ] Add the YouTube URL to **README.md** (replace the `<VIDEO_ID>` placeholder)
- [ ] Add the YouTube URL to **PITCH.md** Slide 1 + One-pager + YC application Q1
- [ ] Add the YouTube URL to **awaazos.vercel.app** marketing landing page (above the fold, autoplay-muted with click-to-unmute)
- [ ] Pin the Twitter/X cut to your founder profile
- [ ] Post the LinkedIn 9:16 cut on your founder LinkedIn (https://www.linkedin.com/in/girishbhiremath)
- [ ] Add to IntelliForge AI website portfolio under "Level 5 — AI App Development"
- [ ] DM the unlisted Loom link to any YC alum / partner you have warm intros with — Loom analytics tell you who watched and for how long

---

## Why this storyboard works (rationale)

| Choice | Rationale |
| ------ | --------- |
| Founder face in scene 1 | YC partners invest in founders, not products. The first 5 seconds is your only chance to humanize before the product takes over. |
| Real Hindi voice command, not VO | The product *is* a voice-in-Hindi product. Demoing it in English would be malpractice. |
| Three items, ₹70 total | Memorable round number. Three items proves multi-item parsing without bloating the demo. |
| Real chai stall background | Anchors the "we live the problem" narrative claimed in PITCH.md. |
| WhatsApp swoosh sound | Universal Indian audio cue. Triggers recognition in any Indian YC partner instantly. |
| 5-second end card | Long enough to screenshot, long enough to read the URL out loud, short enough not to lose engagement. |
| 60s hard cap | YC explicitly requests 60-second demos in the application. Going over signals you don't follow instructions. |
| URL repeated 3× (scene 7 VO + scene 8 visual + caption) | Single most important call-to-action in the entire video. |
| `Built by IntelliForge AI` end-card line | Reinforces studio credibility for partners who Google after watching. |

---

> Storyboard ready to shoot. Estimated production time: **1 weekend** (1 day shoot + 1 day edit). Estimated cost: **₹2,000–₹4,000** (chai stall stipend + lavalier mic if you don't already own one).
>
> Once the YouTube URL exists, replace `<VIDEO_ID>` in this file, in `README.md`, and in `PITCH.md`. All three slots are pre-wired.
