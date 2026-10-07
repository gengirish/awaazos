# AwaazOS — YC Pitch

> **One-liner:** Voice-first POS for India's 60 million micro-merchants. Speak the order, instant UPI QR, WhatsApp receipt. ₹0 to start.

> **Today (May 2026):** Production-deployed. Onboarding our first 10 design-partner chai vendors in Hyderabad in person. Real weekly traction numbers update every Monday from `/admin/metrics`.

> **▶ 60-second demo video:** https://youtu.be/<VIDEO_ID> _(archived April storyboard, now stale: [docs/archive/DEMO_VIDEO.md](./docs/archive/DEMO_VIDEO.md); live walkthrough: [docs/DEMO_GUIDE.md](./docs/DEMO_GUIDE.md))_
>
> **Live app:** https://awaazos.vercel.app · **Repo:** https://github.com/gengirish/awaazos
>
> **Founder:** [Girish Hiremath](https://girishbhiremath.vercel.app) · **Based in:** Hyderabad, India

---

## Part A — YC application (the long form)

### 1. Describe what your company does in 50 characters or less.

> Voice-first POS for India's 60M small vendors.

### 2. Company URL, if any.

https://awaazos.vercel.app

### 3. Demo video (60 seconds)

**▶ Watch:** https://youtu.be/<VIDEO_ID>

**Storyboard + production guide:** [docs/archive/DEMO_VIDEO.md](./docs/archive/DEMO_VIDEO.md) (8 scenes, shot list, equipment + editing checklist). It is archived and stale: it repeats claims that were cut (22 languages, Bharat AI Mission), shows automatic payment detection that does not exist, and predates `wa.me` receipts. Use it for shot structure only; the abridged script below is the current one.

Abridged script for the YC form:

```
[0:00–0:07 · founder selfie, real chai stall in Hyderabad]
Girish: "I'm Girish. India has 60 million micro-merchants.
Zero of them want a typing-based POS."

[0:07–0:15 · B-roll — paper bill book, cash on counter, vendor pouring chai]
VO: "Right now, this is their stack. Paper. Memory. Dispute."

[0:15–0:25 · phone screen — AwaazOS POS, mic button pulsing]
Vendor (in Hindi, into the mic):
"Do special chai, ek aloo samosa, ek mirchi bajji."

[0:25–0:33 · cart fills in real time → ₹70.00]
VO: "Two-second NLU. Hindi today. More languages as cohort demands."

[0:33–0:42 · UPI QR modal, customer scans, Payment received ✓]
VO: "Tap. UPI QR. Customer pays. Zero MDR."

[0:42–0:50 · WhatsApp chat — receipt arrives with bill AWZ-20260423-0042]
VO: "Receipt on WhatsApp. AWZ bill number.
No app install for the customer."

[0:50–0:55 · cut back to founder]
Girish: "Production-deployed today.
awaazos.vercel.app."

[0:55–1:00 · end card — logo, URL]
"Bol. Bill. Becho."
```

### 4. What is your company going to make?

A voice-first point-of-sale and digital billing platform for India's micro-merchants — the chai-walas, dosa carts, paan shops, kirana stores, samosa stalls, juice walas, fruit-cart vendors, and roadside dhabas. They don't speak English, often can't read screens fluently, and have never had software built for the way they actually work.

The core loop is: **vendor speaks the order in their language → AwaazOS transcribes & parses against their menu → customer scans a UPI QR → vendor taps Mark as Paid → atomic bill number generated → WhatsApp receipt sent → owner sees real-time analytics.**

It's a POS where the only interface is your voice and your eyes. **Hindi + English at MVP. More languages on roadmap once 50 vendors are active.**

### 5. Where do you live now, and where would the company be based after YC?

**Hyderabad, India.** Post-YC: SF for the batch, then back to Hyderabad as headquarters with field operations in Mumbai + Bengaluru + Delhi NCR. IntelliForge AI (the operating studio behind AwaazOS) is already incorporated as an Individual Proprietorship in Hyderabad, Telangana.

### 6. Explain your decision regarding location.

Our customers are in India — physically. We need our voice ML team and our customer success team next to chai stalls, watching real users misuse our product, in their language, in real conditions.

**Hyderabad** as HQ: my home base, IntelliForge AI is already operating from here, Telangana has a friendly tech-business climate, Hyderabad's cost-of-talent is meaningfully better than Bengaluru while the engineering hiring pool (especially for Indic NLP — IIIT Hyderabad is across town) is excellent. Field ops scale to **Mumbai** (highest density of micro-merchants), **Bengaluru** (biggest tier-1 voice-AI talent pool for senior hires), and **Delhi NCR** in year 2.

SF for batch: founder-network access, US investor coverage, alumni connect.

### 7. How long have each of you been working on this?

**Indic AI is a 14-year through-line for me, not a 2026 idea.**

In 2012, my first production AI project at a leading semiconductor company was a **Hindi Reader Android app** using OpenCV + Artificial Neural Networks for Devanagari script recognition from camera images — presented at their developer conference. I sat with Indic-language ML constraints for two years.

Fast-forward through fourteen years of enterprise software (banking, pharma, telecom, fintech, IoT) at Fortune 500 companies, founding [IntelliForge AI](https://www.intelliforge.tech) (Hyderabad-based AI studio) in 2025, and starting an **M.Tech in Data Science & AI at IIIT Dharwad** in March 2026 — Speech & NLP is in my coursework right now.

The AwaazOS prototype shipped end-to-end in **4 weekends in April 2026** because three forces aligned: Sarvam's Saaras models hit 91% Hindi accuracy in conversational speech, UPI saturated to 14B txn/month at 0% MDR, and WhatsApp BAPI dropped to ₹0.30/msg via Gupshup. Two years ago this product literally could not exist.

The conviction is older than the product.

### 8. How long have you known one another?

**Solo founder** today — 14 years of solo problem-solving across six industries gives me the breadth to ship the full stack alone (the production deploy at https://awaazos.vercel.app is the proof). Post-YC priority hire is a Bengaluru-based **Indic NLP engineer** (someone with formal NLP training, ideally an IIIT/IIT alum) to deepen the speech-to-text → Claude pipeline beyond what I can architect alone. A **technical co-founder conversation is open** — actively talking to two senior engineers I've worked with at Fortune 500 banks who could join in batch.

### 9. Are you (and any other founders) committed to this full-time?

**Committed full-time within 30 days of YC acceptance.** Currently Principal SE at a Compliance & RegTech company in Hyderabad — notice period is 30 days, all conversations transparent. M.Tech at IIIT Dharwad is part-time / weekend-format, designed to be pursued alongside professional work, and the curriculum (Speech & NLP, Generative AI) directly compounds with what AwaazOS needs — not a distraction.

### 10. Why did you pick this idea to work on?

Three forcing functions converged in 2026:

1. **Indic voice models crossed the bar.** Sarvam's Saaras models hit 91%+ word-accuracy on Hindi/Telugu/Kannada in conversational speech. Two years ago this was 73%. The product literally was not buildable.
2. **UPI saturated.** 14B+ monthly transactions as of Q1 2026. Every Indian customer with a smartphone has GPay/PhonePe/Paytm. The MDR is zero. The settlement is real-time. We don't need to convince anyone to adopt anything — we just need to point a QR at them.
3. **WhatsApp is the receipt channel.** Every customer already has it. AwaazOS opens the vendor's own WhatsApp with the receipt pre-filled (a `wa.me` link) and the vendor taps send, so a receipt costs ₹0 and works on the FREE plan. The Business API route (Gupshup, ~₹0.30/message) is wired in the code for later but not used today.

And on the demand side: I've watched the chai-walas in my own neighborhood in Hyderabad lose ₹400-800/day to memory disputes ("I gave you ₹100, give me ₹70 back" / "you didn't, you gave me ₹50") and to forgotten orders during the evening rush. They won't use any current POS — typing English on a 4-inch screen in a monsoon while five customers wait is not a real product. They WILL speak into a microphone in Hindi or Telugu. That's the entire wedge.

There are 25 million of him.

### 11. Who are your competitors, and who might become competitors? Who do you fear most?

**Petpooja** (Indian POS, ~80K restaurants) — strong in mid-size restaurants. Full-stack, English UI, ₹2-5K/mo. Would not move down-market because their unit economics and salesforce model are built for restaurants, not stalls. Not a threat to our segment; possibly an acquirer at scale.

**Square / Toast** — won't enter India seriously. India payment rails (UPI, RBI, GST) are too country-specific.

**Zomato Hub / Swiftly / Khatabook** — Khatabook is the closest in spirit (250M+ downloads, vernacular, ledger-style). They've struggled to monetize — recurring revenue per user is single-digit rupees. Their wedge is bookkeeping, not POS. We could end up complementary.

**The realistic incumbent**: paper, memory, and the trust between a vendor and his regulars. We are competing with status quo, not with software. Our churn risk is "vendor stops using because product friction > paper friction" — not "vendor switches to competitor".

**Who I fear most**: Razorpay or PhonePe deciding to ship a free POS bundled with their existing acquirer relationships. They have 50M+ merchant relationships already. If they decide voice-first POS is strategic, they'd outspend us. **Mitigation**: get to 50K vendors with strong NPS before they notice; partner with one of them at the Series A.

### 12. What do you understand about your business that other companies in it just don't get?

Three insights, in order of importance:

1. **The interface is the moat — not the AI.** Anyone can call Sarvam + Claude. Almost nobody will get the chai-wala to actually use it. The 80×80 mic button, the six visual states distinguishable beyond color, the saffron palette tested with vendors who have macular issues, the Hindi-language zero-state copy that says "bol bill becho" instead of "create your first transaction" — these are the products. The AI is a commodity.
2. **You cannot build for Indian micro-merchants from a desk.** Every existing POS came from a founder who had used Square/Toast and assumed Bharat would adopt the same patterns. They didn't. We are designing the POS that fits the way orders ACTUALLY happen at a street stall: verbal, fast, plural ("do samosa aur ek chai"), with code-mixing ("two samosa de do na bhai"), and with the customer present.
3. **The unit economics work because the vendor never had software.** A Starter plan at ₹299/mo replaces nothing — it's pure incremental spend. But the value (15-20% revenue recovery from accurate billing + insight into best-seller / busy hour) easily covers ₹299. Vendors that pay ₹299 will not churn for ₹0 alternatives because it's not about the price — it's about the workflow already being baked into their evening routine.

### 13. What's new about what you're making? What substitutes do people resort to because it doesn't exist yet (or they don't know about it)?

**What's new:**
- Voice-first interaction model on a POS — not a "voice feature added to a POS"
- The vendor never types, never reads English, never navigates a menu tree — speech and a QR are the entire workflow

(Engineering details — model routing, paise math, prompt caching, plan gating — are in [ARCHITECTURE.md](./ARCHITECTURE.md). They're table-stakes, not the moat.)

**Substitutes today:**
- Hand-written paper ledgers (~85% of micro-merchants)
- Khatabook for credit tracking (not POS — it's an after-the-fact ledger)
- Memory + dispute (the most common one)
- Asking the customer to "just send to my UPI ID" with no record-keeping
- An English-language POS the vendor's son set up and which they don't actually use

### 14. How do or will you make money?

SaaS subscription, paid in INR via Razorpay UPI autopay or PhonePe Subscriptions.

**₹299/mo per vendor. FREE for first 50 transactions** as activation funnel. Higher tiers come back when ≥50 vendors are paying.

Real CAC, NRPM, LTV will be reported here once we have 30 paying vendors. We refuse to model unit economics from speculation.

### 15. How will you get users? If your idea is the type that faces a chicken-and-egg problem, what's your plan to overcome that?

**No chicken-and-egg.** The vendor onboards alone, gets value alone, pays alone. No two-sided market dynamics.

**Acquisition channels in priority order:**

1. **Field ops in Mumbai/Bengaluru/Delhi** — 3 reps × 8 vendors/day onboarded × 22 days = 528 vendors/month per rep. Cost ₹35K salary + ₹15K travel = ₹50K/rep/month. CAC ≈ ₹95 per vendor. Activation rate target 60% → real CAC ₹160.
2. **Vernacular WhatsApp Status + Instagram Reels** — short videos showing the voice POS in action. Tag location. Costs zero, virality plays well in vendor WhatsApp groups.
3. **Vendor-to-vendor referrals** — the chai-wala next to my chai-wala will see him using it. Built-in referral: "refer a vendor → get a month free Starter". Compound from month 4 onward.
4. **Partner with FMCG distributors** — Hindustan Unilever and ITC have 4M+ shopkeeper relationships. Bundle AwaazOS Starter into their distributor incentive packs.
5. **Press in vernacular** — Aaj Tak, Dainik Bhaskar, ETV Andhra. National English press is a vanity metric for our segment; Hindi/Telugu vernacular media is the actual reach.

### 16. Have you incorporated, or formed any legal entity?

**Yes.** [IntelliForge AI](https://www.intelliforge.tech) is registered as an **Individual Proprietorship in Hyderabad, Telangana, India** (active since 2025) — the operating studio behind AwaazOS. For YC acceptance we will spin AwaazOS into a **Delaware C-Corp** (standard YC structure) with the Indian entity becoming a wholly-owned subsidiary for ground operations, payroll, and merchant relationships. Cap table is clean — 100% founder, no prior outside capital, no SAFEs, no loans.

### 17. If you've already started working on it, how long have you been working and how many lines of code (if applicable) have you written?

Working prototype shipped end-to-end in 4 weekends in April 2026. Production-deployed at https://awaazos.vercel.app — Next.js app on Vercel + BullMQ workers on Fly.io BOM. Onboarding our first 10 design-partner chai vendors in Hyderabad in person right now.

For repo + architecture details, see [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

### 18. If you have an online demo, what's the URL?

https://awaazos.vercel.app

Sign up with any email + password → onboard a stall → add 3-4 menu items → open `/pos` on a phone → tap the orange mic → say _"do samosa aur ek chai"_ in Hindi or English. Mark a sale paid → check `/transactions` and `/analytics`.

### 19. How far along are you? Do you have a beta yet? If not, when will you?

- **Today (May 2026)**: production deployment live; first 10 design-partner chai vendors being onboarded in person in Hyderabad.
- **Next 30 days**: weekly active vendors + voice success rate + GMV reported here every Monday from `/admin/metrics`.

We will not project vendor counts or ARR beyond two weeks out until we have W4 of weekly traction data.

### 20. If you'd like to add anything else, please do.

We are not the first to try POS for Indian small businesses. We are the first to start with the assumption that **the user does not type, does not read English, and does not want to learn software**. Every product decision flows from that.

The bet is simple: voice + UPI + WhatsApp is the *first* technology stack in India that you can ship to a chai-wala and have him become more productive on day one. We have less than 18 months before someone else realises this and ships it. We'd like to be the ones who do.

---

## Part B — 10-slide pitch deck

> Format: speaker-notes style. Each slide is ~30 seconds spoken.

---

### Slide 1 — Title

```
                    AwaazOS
            ─────────────────────
            Bol. Bill. Becho.

      Voice-first POS for Bharat's
        60M micro-merchants.

         awaazos.vercel.app
              YC W26

       ▶ 60s demo: youtu.be/<VIDEO_ID>
```

> **Speaker note:** Open with the 60-second demo video first (full screen, sound on), then advance to slide 2. Archived (stale) storyboard: [docs/archive/DEMO_VIDEO.md](./docs/archive/DEMO_VIDEO.md).

---

### Slide 2 — The problem

> India has **63 million MSMEs**. **25 million are micro-merchants** — chai-walas, dosa carts, kiranas, paan shops, juice stalls.
>
> They take orders **verbally**, in their own language, and most can't read English fluently.
>
> Today they use:
> - Hand-written paper ledgers (lose 15-20% revenue to disputes + forgotten orders)
> - Memory (the most common one — fails by item #4)
> - Or nothing at all
>
> Existing POS systems (Petpooja, Square clones) cost ₹2,000-5,000/mo and assume an English-speaking, software-literate manager. **They don't fit.**

---

### Slide 3 — Our solution

> A POS where the only interface is your **voice** and your **eyes**.
>
> 1. Vendor speaks the order in their language
> 2. AwaazOS transcribes (the browser's Web Speech API for Hindi and English, with a server fallback through OpenAI → Groq → self-hosted Whisper) and parses against their menu (Claude Haiku 4.5 with prompt caching, escalating to Sonnet 4.5 when unsure)
> 3. Cart fills in real time, total computed in paise
> 4. Vendor taps **Collect Payment** → instant UPI QR
> 5. Customer scans → vendor marks paid → atomic bill number `AWZ-YYYYMMDD-NNNN`
> 6. WhatsApp receipt from the vendor's own number → owner dashboard updates live
>
> **End-to-end in 8 seconds.** [Show 60-second demo video]

---

### Slide 4 — Why now

Three things changed in 2025-2026:

| Force | Then | Now |
| --- | --- | --- |
| **Indic voice AI** | Sarvam v1 — 73% word accuracy on Hindi | Sarvam Saaras — 91%+ on Hindi (other Indic langs available, ship as cohort demands) |
| **UPI penetration** | ~3B txn/month (Q1 2024) | **14B+ txn/month** (Q1 2026), 0% MDR, real-time settlement |
| **WhatsApp Business API** | ~₹2/message, restricted templates | **₹0.30/message**, full conversational support via Gupshup |

The product was literally unbuildable two years ago. The next two years will define the category.

---

### Slide 5 — Market

```
                  ┌────────────────────────────────────┐
                  │  TAM — All Indian small business   │
                  │       63M MSMEs                    │
                  │       ₹50,000 Cr POS market         │
                  └─────────────┬──────────────────────┘
                                │
                  ┌─────────────▼──────────────────────┐
                  │  SAM — Voice-language micro-merchants  │
                  │       25M micro-merchants          │
                  │       at ₹299/mo = ₹9,000 Cr/yr   │
                  └─────────────┬──────────────────────┘
                                │
                  ┌─────────────▼──────────────────────┐
                  │  SOM — Tier 1+2 vendors year 3     │
                  │       2.5M reachable                │
                  │       10% capture = 250K paying    │
                  │       ₹90 Cr ARR                    │
                  └────────────────────────────────────┘
```

Even **1% of SAM** at ₹299/mo = **₹75 Cr ARR** (~$9M).

---

### Slide 6 — Product (live, deployed)

> Production today at https://awaazos.vercel.app
>
> **Live design-partner cohort (Hyderabad, May 2026):**
>
> - [PLACEHOLDER: Kalpana Akka, chai stall, Banjara Hills — N voice bills last 7 days, ₹X processed]
> - [PLACEHOLDER: 2nd vendor name + neighbourhood + bill count]
> - [PLACEHOLDER: 3rd vendor name + neighbourhood + bill count]
>
> Weekly active vendors: [PLACEHOLDER: N] · Voice success rate: [PLACEHOLDER: X%] · Weekly GMV: [PLACEHOLDER: ₹Y]
>
> _All numbers updated every Monday from `/admin/metrics`._

---

### Slide 7 — Business model

| Plan | Price/mo | Wedge |
| --- | ---: | --- |
| STARTER | ₹299 | Single-stall vendor, 100-500 txn/mo |

FREE tier (50 txn/mo) exists as activation funnel. Higher tiers come back when ≥50 vendors are paying.

Real CAC, NRPM, LTV will be reported here once we have 30 paying vendors. We refuse to model unit economics from speculation.

---

### Slide 8 — Traction & milestones

| What | Status |
| --- | --- |
| Production deploy | Live at https://awaazos.vercel.app |
| Design-partner cohort | [PLACEHOLDER: N/10] vendors signed in Hyderabad |
| Real-world voice bills last 7 days | [PLACEHOLDER: N] |
| GMV processed last 7 days | [PLACEHOLDER: ₹X] |

We will not project ARR or vendor count beyond two weeks out until we have W4 of weekly traction data.

---

### Slide 9 — Team

> **Girish Hiremath** — Founder, CEO/CTO
>
> 14+ years enterprise software across banking, pharma, fintech, telecom, IoT (Fortune 500). M.Tech in Data Science & AI at **IIIT Dharwad** (Institute of National Importance), Speech & NLP focus. First production Indic AI project in 2012 (Hindi Reader, OpenCV + ANN). Founder of IntelliForge AI (Hyderabad-based studio).
>
> 🌐 [girishbhiremath.vercel.app](https://girishbhiremath.vercel.app) · 🐙 [github.com/gengirish](https://github.com/gengirish)
>
> **Why we'll win**:
> - Production product on day 1 of YC, not day 90 — see https://awaazos.vercel.app
> - 14-year Indic AI arc — Hindi Reader (2012) → IIIT Dharwad Speech & NLP (2026) → AwaazOS (today)
> - Maniacal focus on the chai-wala, not the restaurant
> - India-first defaults baked into every line of code (see [ARCHITECTURE.md](./ARCHITECTURE.md))

---

### Slide 10 — The ask

> Standard YC deal ($500K). 12 months gets us:
>
> - From [PLACEHOLDER: N] design partners to ≥1,000 daily-active vendors in 3 cities
> - Hindi-first, English fallback. Other languages added as cohort demands.
> - Series A conversation starts when weekly active vendors > 1,000 with ≥40% W4 retention. No earlier.
>
> **Bol. Bill. Becho.** Built for Bharat. Ready to ship.

---

## Part C — Founder FAQ (the hard questions)

### Q: Why won't Razorpay/PhonePe just build this?

**A:** They might. They have the merchant relationships. But:
- They're acquirers, not product companies. Their internal incentive is to ship the next payment instrument, not a vertical SaaS.
- Voice-first UX is not their muscle — they ship dashboards for shopkeepers who already have software, not POS-replacement for shopkeepers who have none.
- We ship faster. We can be at 50K vendors before they form an internal taskforce.
- If they do build it, we partner. Razorpay distributing AwaazOS as their default merchant POS is a Series B story, not a competitive threat.

### Q: Sarvam is a vendor risk. What if they shut down or 10× pricing?

**A:** Sarvam is no longer on the default path, and no single STT vendor is:
1. **Web Speech API covers en/hi for free** (Chrome / Edge / Samsung Browser native). Hindi and English are the only languages vendors can pick today, so most transcripts never leave the phone as audio.
2. **The server path is already multi-provider.** `POST /api/ai/transcribe` runs a cascade, each hop behind its own circuit breaker and quota: en/hi go OpenAI → Groq → self-hosted Whisper; Telugu/Kannada/Tamil (kept in code, not offered yet) go Sarvam → Groq → Whisper. Each provider is a small module (`lib/sarvam.ts`, `lib/openai-stt.ts`, `lib/groq-stt.ts`, `lib/whisper-stt.ts`) with the same `transcribeAudio()` shape, and we have already removed one provider (NVIDIA) with no change to the parsing logic beyond dropping its name from an input enum. A new provider has to pass the golden STT suite before it joins. The pricing risk is real but the lock-in is low.

### Q: What about offline mode? India has spotty internet.

**A:** Tier 1 + 2 cities (where 80% of our SAM is) have 4G coverage at the stall level. We're online-only at MVP and will revisit offline once weekly active vendors > 100.

### Q: GST? Most micro-merchants don't have GSTIN. What about the ones that do?

**A:** Most micro-merchants are below the ₹40L turnover threshold and stay GST-exempt — that's our wedge cohort. For the ones that aren't, what has shipped is an optional HSN/SAC code per menu item, printed on the WhatsApp receipt, and one flat tax rate the vendor can switch on. Full GST invoicing (CGST/SGST/IGST split, GSTIN on the bill) is not built; we'll add it when paying vendors ask for it.

### Q: Why ₹299, not ₹99?

**A:** Tested in informal interviews — vendors will pay ₹299 if the value is "you get back 15-20% in lost revenue from disputes". Below ₹299, perceived value drops sharply ("if it's only ₹99 it can't be serious"). Above ₹499, payment friction kicks in. ₹299 is the local maximum.

We will offer FREE for the first 50 monthly transactions to remove activation friction. Conversion to STARTER target: 25% within 60 days.

### Q: Single founder. Why?

**A:** Three honest reasons:

1. **Shipping velocity is already proven solo.** The production deploy at https://awaazos.vercel.app — full Next.js app + Auth.js + Prisma + Neon + Anthropic + a multi-provider STT cascade + Razorpay + Fly worker, with unit + E2E test coverage — was built solo in 4 weekends. Most "co-founded" YC applicants at this stage have a Figma. We have a deploy.

2. **14 years of solo problem-solving across six industries** (banking / pharma / telecom / fintech / IoT / compliance) gave me the breadth to cover full-stack + DevOps + payments + AI without bottlenecks. The architecture document ([ARCHITECTURE.md](./ARCHITECTURE.md)) reflects 14 years of "doing it the hard way" in enterprise contexts.

3. **A technical co-founder conversation is open.** Two senior engineers from prior Fortune 500 work (one banking, one pharma) are in active conversation. If one of them joins in batch, great. If not, **first-month YC priority hire is a Bengaluru-based Indic NLP engineer** (IIIT/IIT alum) to deepen the speech-to-text → Claude pipeline beyond what I can architect alone.

YC has funded plenty of single founders who shipped (Drew at Dropbox, Patrick at Stripe before John joined, etc.). I'd rather be a strong single founder with a working product than a weak two-founder with a deck.

### Q: How does this not just become "another POS"?

**A:** Two structural reasons:
1. **Voice-first lock-in**: once a vendor's evening routine is "speak the order, scan the QR", switching back to typing on any other POS is painful. The interface IS the moat.
2. **Per-vendor menu cache + voice telemetry**: every transaction makes the parser better at THIS vendor's menu, including their colloquial item names ("paneer wala roll" vs "paneer roll"). Year 2 vendors get 95%+ first-shot accuracy because of year 1 vendors. Network effects in the data layer.

---

## Part D — One-pager (printable)

```
┌──────────────────────────────────────────────────────────────────┐
│  AwaazOS — Bol. Bill. Becho.                                    │
│  Voice-first POS for India's 60M micro-merchants                 │
│  awaazos.vercel.app  ·  YC W26                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROBLEM                                                         │
│  25M Indian micro-merchants — chai walas, kiranas, dosa carts —  │
│  have no POS. They speak orders, write paper bills, lose 15-20%  │
│  revenue to disputes. Existing POS (₹2-5K/mo) is built for       │
│  English-speaking restaurant managers, not them.                 │
│                                                                  │
│  SOLUTION                                                        │
│  Vendor speaks order in their language → speech-to-text + Claude │
│  parses against menu → cart fills → UPI QR → WhatsApp receipt    │
│  → live dashboard. 8 seconds end-to-end. ₹299/mo.                │
│                                                                  │
│  WHY NOW                                                         │
│  Indic voice AI crossed 91% accuracy (2025).                     │
│  UPI at 14B txn/mo (2026) with 0% MDR.                           │
│  WhatsApp BAPI at ₹0.30/msg (2026).                              │
│  Two years ago, this product could not exist.                    │
│                                                                  │
│  MARKET                                                          │
│  TAM ₹50K Cr  ·  SAM ₹9K Cr  ·  SOM ₹90 Cr (10% × 2.5M reachable)│
│                                                                  │
│  TRACTION                                                        │
│  Production deployed today (May 2026).                           │
│  Onboarding first 10 design-partner chai vendors in Hyderabad.   │
│  Weekly numbers update every Monday at /admin/metrics.           │
│                                                                  │
│  BUSINESS MODEL                                                  │
│  ₹299/mo per vendor. FREE for first 50 transactions.             │
│  Real CAC, NRPM, LTV reported here once 30 vendors are paying.   │
│                                                                  │
│  TEAM                                                            │
│  Girish Hiremath — Founder, CEO/CTO                              │
│  14+ yrs enterprise eng (Fortune 500: banking, pharma, telecom)  │
│  M.Tech DSAI @ IIIT Dharwad — Speech & NLP focus                 │
│  First Indic AI project: Hindi Reader (OpenCV + ANN), 2012       │
│  Founder of IntelliForge AI — Hyderabad-based studio             │
│  girishbhiremath.vercel.app · github.com/gengirish               │
│                                                                  │
│  ASK                                                             │
│  Standard YC deal ($500K). 12 months runway to take design       │
│  partners → ≥1,000 daily-active vendors in 3 cities.             │
│                                                                  │
│  60-SEC DEMO  ▶  youtu.be/<VIDEO_ID>                             │
│                                                                  │
│  CONTACT                                                         │
│  gen.girish@gmail.com · contact@intelliforge.tech                │
│  awaazos.vercel.app · github.com/gengirish/awaazos               │
│  Hyderabad, Telangana, India 🇮🇳                                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Part E — Demo script (in-person, 5 minutes)

**0:00–0:30 — Frame the user**
> "I'm Girish — fourteen years building enterprise software for Fortune 500 banks and pharma giants, currently doing my M.Tech in Speech & NLP at IIIT Dharwad. My very first production AI project was in 2012 — a Hindi Reader Android app at a semiconductor company. I've been waiting fourteen years to build the right thing for Indic AI. Today I'll show you what that is.
>
> Imagine you're standing at a chai stall in Hyderabad. Monsoon. 6 PM. Twenty people in line. The vendor is making chai, taking orders, handing change. He sells 200 cups a day. He has zero software. Show of hands — who thinks an English-language POS is going to work for him?"

**0:30–1:30 — Live the product**
> [Open https://awaazos.vercel.app/pos on a phone projected to screen]
> "I'm Ramesh now. I'll add my menu in 30 seconds — chai 10, samosa 15, vada pav 20. Customer comes up, says: _'bhaiya, do samosa aur ek chai'_. Watch."
> [Tap mic, speak in Hindi, cart fills with 2 samosa + 1 chai = ₹40]
> "Customer pays. Tap collect. UPI QR. They scan. Mark paid. Bill AWZ-20260423-0001 generated. WhatsApp receipt sent."

**1:30–2:30 — Show analytics**
> [Open `/analytics`]
> "End of day. Ramesh sees ₹4,127 today. Chai is 47 cups. Voice ordered 89% of orders. Best hour: 6-7 PM. Yesterday ₹3,210. Up 28%. He's never had this before."

**2:30–3:30 — Architecture flex (optional, if technical audience)**
> [Open ARCHITECTURE.md mermaid diagrams]
> "Production today. The engineering details — two-tier model routing, atomic bill numbering, multi-tenant isolation, background workers — are in [ARCHITECTURE.md](./ARCHITECTURE.md). Happy to go deep on any of it."

**3:30–4:30 — The why**
> "There are 25 million Rameshes. Existing POS doesn't fit them. Voice + UPI + WhatsApp is the first stack that does. We're 18 months from an incumbent shipping this. We'd like to be the ones who do — with YC."

**4:30–5:00 — Ask & close**
> "Standard YC deal. 12 months. From design partners → ≥1,000 daily-active vendors in 3 cities. Series A conversation starts when weekly active vendors > 1,000 with ≥40% W4 retention. No earlier.
>
> **Bol. Bill. Becho.** Thank you."

---

## Part F — Minimal product cut list

On 24 April 2026 (commit `d5a808f`) the public surface was cut down to one wedge: speak the order, UPI, done. The cut is **UI only**. Plan enforcement, the Prisma schema and the APIs were left intact, and the hidden code is commented out rather than deleted, marked `HIDDEN — see PITCH.md "minimal product" cut list`. The commit set the re-enable trigger at **≥50 weekly active vendors**; the code comments say "when STARTER GA".

**Still cut:**

| What | Where | State today |
| --- | --- | --- |
| PRO and ENTERPRISE on the pricing page | `app/(marketing)/pricing/page.tsx` | `VISIBLE_TIERS = ["FREE", "STARTER"]`; the four-plan comparison table is commented out. `e2e/public.spec.ts` asserts PRO stays off this page (`433164c`). |
| PRO tile on the landing page | `components/marketing/PricingTeaser.tsx` | Two tiles, FREE and STARTER. |
| PRO upgrade in billing settings | `components/billing/BillingManageClient.tsx`, `components/billing/PricingPlanButtons.tsx` | Only "Upgrade to Starter" is shown; the button type allows FREE or STARTER. |
| Voice languages beyond Hindi and English | `VOICE_LANGUAGES` in `lib/constants.ts` | Picker shows English and Hindi only. Telugu, Kannada and Tamil stay wired in the STT code, and an old stored choice still routes through them. |
| Plan names in the CSV-export tooltip | `components/transactions/TransactionsTable.tsx` | Says "available on a higher plan" without naming PRO. |

**Restored since:** the `/analytics` chart dashboard, which the cut had replaced with a single hero card, came back in `5718acd` (2 May 2026).

**Kept underneath:** `PLAN_LIMITS` in `lib/constants.ts` still defines PRO at ₹799/mo (unlimited bills, unlimited staff, CSV export, 365-day analytics) and ENTERPRISE (custom). `POST /api/razorpay/create-subscription` still accepts `PRO`. Because no screen offers PRO, the PRO-gated features (CSV export and connecting a vendor's own Razorpay keys for storefront payments) can only be unlocked today by changing a vendor's plan directly.

---

> Built for the chai-wala in Hyderabad, the dosa cart in Bengaluru, the kirana shop in Indore, the paan stall in Kolkata.
>
> 🇮🇳 **AwaazOS — Bol. Bill. Becho.**
