# Live demo guide (investors, partners, design reviews)

Use this for **in-person or Zoom** walkthroughs. For **recording a 60s YC video**, the old storyboard is archived at [`archive/DEMO_VIDEO.md`](archive/DEMO_VIDEO.md). It is stale (cut claims such as 22 languages, automatic payment detection that doesn't exist, Gupshup receipts), so use it for shot structure only and take the script from `PITCH.md` §3.

---

## Before you start (2 minutes)

1. **Open production** in a clean browser profile (or incognito): [https://awaazos.vercel.app](https://awaazos.vercel.app)
2. **Sanity-check backends** (optional but professional):
   - [https://awaazos.vercel.app/api/health](https://awaazos.vercel.app/api/health) → `200`, `"status":"ok"`
   - [https://awaazos.vercel.app/api/ready](https://awaazos.vercel.app/api/ready) → `200`, both `database` and `redis` probes `ok: true`
3. **Account**: demo in **Hindi or English** — those are the only languages in the voice picker (Settings → Voice). Telugu, Kannada and Tamil are dormant in the code and can't be selected; Marathi and Bengali are not supported. **FREE** is fine: by default Hindi and English are transcribed in the browser (Web Speech), which isn't plan-gated. Only the server STT route (`/api/ai/transcribe`) needs STARTER, and the POS calls it only when the deployment is built with `NEXT_PUBLIC_VOICE_FALLBACK_ENABLED=true`.
4. **Menu**: pre-create 3 items with obvious Hindi names and round prices (e.g. Special Chai ₹20, Aloo Samosa ₹15, Mirchi Bajji ₹15) so mental math is easy.
5. **Phone**: charge the device; enable **mic permission** for the site; use **Chrome** on Android or desktop. A browser without Web Speech shows a "not supported" error rather than falling back to the server, so check this before the meeting.
6. **WhatsApp** (optional beat): the demo phone needs WhatsApp installed. Receipts go out as a `wa.me` link: **Send on WhatsApp** opens the vendor's own WhatsApp with the receipt pre-filled, and you tap send. Have a **second number** ready to type in as the customer's mobile. No Gupshup, Redis or worker is involved, and it works on FREE.

---

## 5-minute demo script (talk track)

**Minute 0 — Problem (30s)**  
“India has tens of millions of stalls that run on voice, paper, and memory. Typing-first POS never fit them.”

**Minute 0.5 — Product (4m)**  

1. **Sign in** → **POS** (`/pos`). Empty cart.
2. Tap the **mic** (“Bolo”). Say clearly in your chosen language, e.g. Hindi: *“Do special chai, ek aloo samosa, ek mirchi bajji.”*  
   - *Talk track:* “Speech-to-text runs in the browser for Hindi and English, with a server fallback that cascades OpenAI → Groq → our own Whisper. The order itself is parsed by Claude against the vendor’s real menu — Haiku first, Sonnet if it’s unsure.”
3. **Cart** fills with lines + **₹ total**.  
   - *Talk track:* “Integer paise in the DB—no float money bugs.”
4. **Collect payment** → **UPI QR**.  
   - *Talk track:* “Vendor’s own UPI ID; customer scans with any UPI app.”
5. **Mark as paid** (simulate or real payment). Show **bill number** `AWZ-YYYYMMDD-NNNN`.  
   - *Talk track:* “Atomic bill sequence inside one Postgres transaction.”
6. Optional: type the second number and tap **Send on WhatsApp**; WhatsApp opens with the receipt ready, tap send, show it arrive.  
   - *Talk track:* “Receipt comes from the vendor’s own WhatsApp — free, no Business API, no app for the customer.”
7. **Analytics** (`/analytics`): revenue trend, voice adoption.  
   - *Talk track:* “Owner sees what sold and whether voice is being adopted.”

**Close (15s)**  
“Live stack: Next.js on Vercel, Neon Postgres, Claude for parsing, browser speech plus a multi-provider STT fallback, BullMQ workers on Fly. **Bol. Bill. Becho.**”

---

## If something breaks during the demo

| Symptom | Likely cause | What to say / do |
| --- | --- | --- |
| Mic does nothing | Browser blocked mic | “Allow microphone for this site”; refresh. |
| Mic shows “not supported” | Browser has no Web Speech (e.g. Firefox, some in-app browsers) | Switch to Chrome; meanwhile bill from the **quick-add grid**. |
| Voice drops to the tap grid with a degraded notice | Server STT cascade exhausted (only when the fallback flag is on) | Expected behaviour, not a crash: “every voice path has a tap fallback.” Carry on from the quick-add grid. |
| Cart empty after voice | Network / API error | Open DevTools → Network on `parse-order`; fall back to **manual add** from quick grid—still shows billing + UPI. |
| `/api/ready` Redis fails | Missing or wrong `UPSTASH_*` on Vercel | Don’t show the JSON to the room; fix env and redeploy before the next meeting. |
| WhatsApp doesn't open | Popup blocked, WhatsApp not installed, or the number isn't 10 digits | Leave the number blank to pick the chat inside WhatsApp, or show the bill in `/transactions` and use **Send on WhatsApp** from the detail drawer. |

---

## After the meeting

- [ ] Note questions asked → feed into roadmap / `PITCH.md`
- [ ] If you showed prod URLs, remind viewers **not to abuse** the public signup
- [ ] For YC / press, prioritize publishing the **60s video** and replacing the `<VIDEO_ID>` placeholders in `README.md` + `PITCH.md`

---

## Related docs

- [`../README.md`](../README.md) — quickstart, live URLs, deploy
- [`archive/DEMO_VIDEO.md`](archive/DEMO_VIDEO.md) — archived, stale shot list + export settings for the 60s film
- [`../PITCH.md`](../PITCH.md) — YC narrative and deck
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — system topology (Vercel vs Fly vs Redis)
