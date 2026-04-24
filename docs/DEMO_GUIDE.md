# Live demo guide (investors, partners, design reviews)

Use this for **in-person or Zoom** walkthroughs. For **recording a 60s YC video**, follow [`../DEMO_VIDEO.md`](../DEMO_VIDEO.md) instead.

---

## Before you start (2 minutes)

1. **Open production** in a clean browser profile (or incognito): [https://awaazos.vercel.app](https://awaazos.vercel.app)
2. **Sanity-check backends** (optional but professional):
   - [https://awaazos.vercel.app/api/health](https://awaazos.vercel.app/api/health) → `200`, `"status":"ok"`
   - [https://awaazos.vercel.app/api/ready](https://awaazos.vercel.app/api/ready) → `200`, both `database` and `redis` probes `ok: true`
3. **Account**: use a demo vendor with **STARTER or above** if you will speak **Telugu / Kannada / Tamil / Marathi / Bengali** (Sarvam STT is plan-gated). **FREE** is fine for **English / Hindi** (Web Speech).
4. **Menu**: pre-create 3 items with obvious Hindi names and round prices (e.g. Special Chai ₹20, Aloo Samosa ₹15, Mirchi Bajji ₹15) so mental math is easy.
5. **Phone**: charge the device; enable **mic permission** for the site; use **Chrome** on Android or desktop for the most predictable Web Speech path.
6. **WhatsApp** (optional beat): have a **second number** in settings as the receipt destination, and confirm **Gupshup** + worker env are live if you promise “receipt lands in WhatsApp.”

---

## 5-minute demo script (talk track)

**Minute 0 — Problem (30s)**  
“India has tens of millions of stalls that run on voice, paper, and memory. Typing-first POS never fit them.”

**Minute 0.5 — Product (4m)**  

1. **Sign in** → **POS** (`/pos`). Empty cart.
2. Tap the **mic** (“Bolo”). Say clearly in your chosen language, e.g. Hindi: *“Do special chai, ek aloo samosa, ek mirchi bajji.”*  
   - *Talk track:* “Transcription routes to Web Speech or Sarvam; parsing is Claude with the vendor’s real menu.”
3. **Cart** fills with lines + **₹ total**.  
   - *Talk track:* “Integer paise in the DB—no float money bugs.”
4. **Collect payment** → **UPI QR**.  
   - *Talk track:* “Vendor’s own UPI ID; customer scans with any UPI app.”
5. **Mark as paid** (simulate or real payment). Show **bill number** `AWZ-YYYYMMDD-NNNN`.  
   - *Talk track:* “Atomic bill sequence inside one Postgres transaction.”
6. If WhatsApp is configured: show **receipt** on the phone.  
   - *Talk track:* “Queued on Redis, sent by a Fly.io worker—retries, idempotent.”
7. **Analytics** (`/analytics`): revenue trend, voice adoption.  
   - *Talk track:* “Owner sees what sold and whether voice is being adopted.”

**Close (15s)**  
“Live stack: Next.js on Vercel, Neon Postgres, Claude + Sarvam, BullMQ workers on Fly. **Bol. Bill. Becho.**”

---

## If something breaks during the demo

| Symptom | Likely cause | What to say / do |
| --- | --- | --- |
| Mic does nothing | Browser blocked mic | “Allow microphone for this site”; refresh. |
| Hindi works, Indic language fails | Plan is FREE | “That language uses Sarvam—I'll show on STARTER”; switch account or use Hindi. |
| Cart empty after voice | Network / API error | Open DevTools → Network on `parse-order`; fall back to **manual add** from quick grid—still shows billing + UPI. |
| `/api/ready` Redis fails | Missing or wrong `UPSTASH_*` on Vercel | Don’t show the JSON to the room; fix env and redeploy before the next meeting. |
| WhatsApp never arrives | Worker down / Gupshup env | “Receipt is in the app and DB; WhatsApp is async”—show transaction detail + resend if UI allows. |

---

## After the meeting

- [ ] Note questions asked → feed into roadmap / `PITCH.md`
- [ ] If you showed prod URLs, remind viewers **not to abuse** the public signup
- [ ] For YC / press, prioritize publishing the **60s video** and linking it from `README.md` + `PITCH.md` (placeholders: `DEMO_VIDEO.md`)

---

## Related docs

- [`../README.md`](../README.md) — quickstart, live URLs, deploy
- [`../DEMO_VIDEO.md`](../DEMO_VIDEO.md) — shot list + export settings for the 60s film
- [`../PITCH.md`](../PITCH.md) — YC narrative and deck
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — system topology (Vercel vs Fly vs Redis)
