# AwaazOS — YC Pitch

> **One-liner:** Voice-first POS in 22 Indian languages for India's 60 million micro-merchants. Speak the order, instant UPI QR, WhatsApp receipt. ₹0 to start.

> **▶ 60-second demo video:** https://youtu.be/<VIDEO_ID> _(storyboard: [DEMO_VIDEO.md](./DEMO_VIDEO.md); live walkthrough: [docs/DEMO_GUIDE.md](./docs/DEMO_GUIDE.md))_
>
> **Live app:** https://awaazos.vercel.app · **Repo:** https://github.com/gengirish/awaazos
>
> **Founder:** [Girish Hiremath](https://girishbhiremath.vercel.app) · **Studio:** [IntelliForge AI](https://www.intelliforge.tech) · **Based in:** Hyderabad, India · **Aligned with:** Bharat AI Mission

---

## Part A — YC application (the long form)

### 1. Describe what your company does in 50 characters or less.

> Voice-first POS for India's 60M small vendors.

### 2. Company URL, if any.

https://awaazos.vercel.app

### 3. Demo video (60 seconds)

**▶ Watch:** https://youtu.be/<VIDEO_ID>

**Canonical storyboard + production guide:** [DEMO_VIDEO.md](./DEMO_VIDEO.md) (8 scenes, full shot list, equipment + editing checklist)

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
VO: "Two-second NLU. Hindi, Telugu, Kannada — twenty-two languages."

[0:33–0:42 · UPI QR modal, customer scans, Payment received ✓]
VO: "Tap. UPI QR. Customer pays. Zero MDR."

[0:42–0:50 · WhatsApp chat — receipt arrives with bill AWZ-20260423-0042]
VO: "Receipt on WhatsApp. AWZ bill number. GST-ready.
No app install for the customer."

[0:50–0:55 · cut back to founder]
Girish: "All in 22 Indian languages. Production-deployed today.
awaazos.vercel.app."

[0:55–1:00 · end card — logo, URL, IntelliForge AI, Bharat AI Mission]
"Bol. Bill. Becho."
```

### 4. What is your company going to make?

A voice-first point-of-sale and digital billing platform for India's micro-merchants — the chai-walas, dosa carts, paan shops, kirana stores, samosa stalls, juice walas, fruit-cart vendors, and roadside dhabas. They don't speak English, often can't read screens fluently, and have never had software built for the way they actually work.

The core loop is: **vendor speaks the order in their language → AwaazOS transcribes & parses against their menu → customer scans a UPI QR → vendor taps Mark as Paid → atomic bill number generated → WhatsApp receipt sent → owner sees real-time analytics.**

It's a POS where the only interface is your voice and your eyes. We support Hindi, Telugu, Kannada, Tamil, Marathi, Bengali at launch — every Indic Saaras-supported language at full GA.

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

The AwaazOS prototype shipped end-to-end in **4 weekends in April 2026** because three forces aligned: Sarvam Saaras v2 hit 91% Hindi accuracy in conversational speech, UPI saturated to 14B txn/month at 0% MDR, and WhatsApp BAPI dropped to ₹0.30/msg via Gupshup. Two years ago this product literally could not exist.

The conviction is older than the product.

### 8. How long have you known one another?

**Solo founder** today — 14 years of solo problem-solving across six industries gives me the breadth to ship the full stack alone (the production deploy at https://awaazos.vercel.app is the proof). Post-YC priority hire is a Bengaluru-based **Indic NLP engineer** (someone with formal NLP training, ideally an IIIT/IIT alum) to deepen the Sarvam → Claude pipeline beyond what I can architect alone. A **technical co-founder conversation is open** — actively talking to two senior engineers I've worked with at Fortune 500 banks who could join in batch.

### 9. Are you (and any other founders) committed to this full-time?

**Committed full-time within 30 days of YC acceptance.** Currently Principal SE at a Compliance & RegTech company in Hyderabad — notice period is 30 days, all conversations transparent. M.Tech at IIIT Dharwad is part-time / weekend-format, designed to be pursued alongside professional work, and the curriculum (Speech & NLP, Generative AI) directly compounds with what AwaazOS needs — not a distraction.

### 10. Why did you pick this idea to work on?

Three forcing functions converged in 2026:

1. **Indic voice models crossed the bar.** Sarvam Saaras v2 hit 91%+ word-accuracy on Hindi/Telugu/Kannada in conversational speech. Two years ago this was 73%. The product literally was not buildable.
2. **UPI saturated.** 14B+ monthly transactions as of Q1 2026. Every Indian customer with a smartphone has GPay/PhonePe/Paytm. The MDR is zero. The settlement is real-time. We don't need to convince anyone to adopt anything — we just need to point a QR at them.
3. **WhatsApp Business API got cheap.** Gupshup at ₹0.30/message means a vendor doing 200 sales/day can send digital receipts at ₹60/day = ₹1,800/mo. Affordable on a Starter plan ₹299 with margin to spare.

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
- Two-tier Claude routing (Haiku → Sonnet on low confidence) — saves ~70% on inference vs always-Sonnet
- India-pragmatic invariants (paise integers everywhere, IST-pinned bill numbers, +91 phone validation, prompt-cached menu blocks per vendor)
- Plan gating that returns structured 402s the UI uses to render contextual upgrade prompts (not generic paywalls)

**Substitutes today:**
- Hand-written paper ledgers (~85% of micro-merchants)
- Khatabook for credit tracking (not POS — it's an after-the-fact ledger)
- Memory + dispute (the most common one)
- Asking the customer to "just send to my UPI ID" with no record-keeping
- An English-language POS the vendor's son set up and which they don't actually use

### 14. How do or will you make money?

SaaS subscription, paid in INR via Razorpay UPI autopay or PhonePe Subscriptions:

| Plan | Price/mo | Target segment |
| --- | ---: | --- |
| FREE | ₹0 | New vendors, ≤50 txn/month — funnel to STARTER |
| STARTER | ₹299 | Single-stall vendors, 100-500 txn/mo (the wedge) |
| PRO | ₹799 | Multi-stall, busy locations, restaurant-class with GST |
| ENTERPRISE | Custom | Chain operators, FMCG distribution, kirana franchises |

Net revenue per paying merchant: ₹299/mo × 12 = ₹3,588/year (Starter). At 5% gross margin loss to payment provider + 3% bad debt, NRPM ≈ ₹3,290.

**Future revenue lines** (not Year 1):
- WhatsApp Business catalog commerce — vendors sell via WhatsApp chat, take 1% transaction fee
- Inventory financing for small vendors — partner with NBFCs for working-capital loans (₹5K-₹50K), take 2% origination
- Vendor-to-vendor marketplace — chai vendor buys cups from cup wholesaler in-app, take 0.5%

### 15. How will you get users? If your idea is the type that faces a chicken-and-egg problem, what's your plan to overcome that?

**No chicken-and-egg.** The vendor onboards alone, gets value alone, pays alone. No two-sided market dynamics.

**Acquisition channels in priority order:**

1. **Field ops in Mumbai/Bengaluru/Delhi** — 3 reps × 8 vendors/day onboarded × 22 days = 528 vendors/month per rep. Cost ₹35K salary + ₹15K travel = ₹50K/rep/month. CAC ≈ ₹95 per vendor. Activation rate target 60% → real CAC ₹160.
2. **Vernacular WhatsApp Status + Instagram Reels** — short videos showing the voice POS in action. Tag location. Costs zero, virality plays well in vendor WhatsApp groups.
3. **Vendor-to-vendor referrals** — the chai-wala next to my chai-wala will see him using it. Built-in referral: "refer a vendor → get a month free Starter". Compound from month 4 onward.
4. **Partner with FMCG distributors** — Hindustan Unilever and ITC have 4M+ shopkeeper relationships. Bundle AwaazOS Starter into their distributor incentive packs.
5. **Press in vernacular** — Aaj Tak, Dainik Bhaskar, ETV Andhra. National English press is a vanity metric for our segment; Hindi/Telugu vernacular media is the actual reach.

### 16. Have you incorporated, or formed any legal entity?

**Yes.** [IntelliForge AI](https://www.intelliforge.tech) is registered as an **Individual Proprietorship in Hyderabad, Telangana, India** (active since 2025) — the operating studio that incubated AwaazOS as a Level-5 (App Development) flagship product. For YC acceptance we will spin AwaazOS into a **Delaware C-Corp** (standard YC structure) with the Indian entity becoming a wholly-owned subsidiary for ground operations, payroll, and merchant relationships. Cap table is clean — 100% founder, no prior outside capital, no SAFEs, no loans.

### 17. If you've already started working on it, how long have you been working and how many lines of code (if applicable) have you written?

Working prototype shipped end-to-end in 4 weekends in April 2026. As of this writing:

- **20,825 lines of TypeScript / TSX** (excluding generated Prisma client and `node_modules`)
- **51 unit tests** + **38 E2E tests** across chromium and mobile, all passing on every commit
- **25 production routes** deployed to Vercel + 2 BullMQ workers running on Fly.io BOM
- **Zero production users yet** — looking for design partners (10 vendors in Bengaluru / Mumbai willing to use the alpha for 30 days)

The codebase quality is the artifact: see [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

### 18. If you have an online demo, what's the URL?

https://awaazos.vercel.app

Sign up with any email + password → onboard a stall → add 3-4 menu items → open `/pos` on a phone → tap the orange mic → say _"do samosa aur ek chai"_ in Hindi or English. Mark a sale paid → check `/transactions` and `/analytics`.

### 19. How far along are you? Do you have a beta yet? If not, when will you?

- **Today (Apr 2026)**: production deployment, end-to-end working, no users yet
- **Beta (May 2026)**: 10 design-partner vendors in Bengaluru, weekly in-person installs
- **Public launch (Jul 2026)**: Mumbai + Bengaluru open onboarding, target 500 active vendors
- **Series A milestone (Mar 2027)**: 10,000 paying vendors, ₹1.5 Cr ARR, 70%+ DAU/MAU

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

> **Speaker note:** Open with the 60-second demo video first (full screen, sound on), then advance to slide 2. Storyboard + production guide: [DEMO_VIDEO.md](./DEMO_VIDEO.md).

---

### Slide 2 — The problem

> India has **63 million MSMEs**. **25 million are micro-merchants** — chai-walas, dosa carts, kiranas, paan shops, juice stalls.
>
> They take orders **verbally**, in **22 different languages**, and most can't read English fluently.
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
> 2. AwaazOS transcribes (Sarvam Saaras v2 + Web Speech) and parses against their menu (Claude Haiku 4.5 with prompt caching)
> 3. Cart fills in real time, total computed in paise
> 4. Vendor taps **Collect Payment** → instant UPI QR
> 5. Customer scans → vendor marks paid → atomic bill number `AWZ-YYYYMMDD-NNNN`
> 6. WhatsApp receipt → owner dashboard updates live
>
> **End-to-end in 8 seconds.** [Show 60-second demo video]

---

### Slide 4 — Why now

Three things changed in 2025-2026:

| Force | Then | Now |
| --- | --- | --- |
| **Indic voice AI** | Sarvam v1 — 73% word accuracy on Hindi | Sarvam Saaras v2 — 91%+ on Hindi/Te/Kn/Ta/Mr/Bn |
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

> Not a prototype. Not a Figma. **Production today** at https://awaazos.vercel.app
>
> What's shipped:
> - 80×80 mic with 6 visual states (accessibility-first)
> - Two-tier Claude routing (Haiku → Sonnet escalation)
> - Atomic bill numbering inside `prisma.$transaction`
> - WhatsApp receipt queue (BullMQ on Fly.io BOM region)
> - Razorpay subscriptions with structured plan-gate 402s
> - Recharts analytics with screen-reader data tables
> - 51 unit tests + 38 E2E tests across chromium + mobile
> - Multi-tenant + RBAC at platform and per-vendor layers
>
> **20,825 lines of TypeScript. 25 production routes. Zero hosted users yet.**

---

### Slide 7 — Business model

| Plan | Price/mo | Wedge |
| --- | ---: | --- |
| FREE | ₹0 | Funnel — get to first 50 transactions |
| **STARTER** | **₹299** | **The wedge — single-stall vendor, 100-500 txn/mo** |
| PRO | ₹799 | Multi-stall, GST-enabled, restaurants |
| ENTERPRISE | Custom | Kirana chains, FMCG distributor bundles |

- **CAC** target: ₹160 (field ops + referral compound)
- **NRPM**: ₹3,290/yr (Starter)
- **LTV/CAC at month 18**: 18× (assuming 50% Y1 retention)
- **Gross margin**: 78% at scale (infra + payments fees + SMS + Anthropic)

Future revenue: WhatsApp catalog commerce (1% txn), vendor financing (2% origination), B2B marketplace (0.5%).

---

### Slide 8 — Traction & milestones

> **Today (Apr 2026)**: production-deployed, 0 users, looking for 10 design partners.
>
> | Phase | When | Milestone | Vendors |
> | --- | --- | --- | --- |
> | Beta | May 2026 | Bengaluru in-person installs | 10 |
> | Soft launch | Jul 2026 | Mumbai + Bengaluru | 500 |
> | Geographic expand | Oct 2026 | + Delhi NCR + Hyderabad | 2,500 |
> | Series A target | Mar 2027 | National + first chains | **10,000** |
> | YC Demo Day | Aug 2026 | 1,500 paying vendors, ₹4.5L MRR | — |

> **Y2 ARR target**: ₹3 Cr ($360K) at 8,000 paying STARTER + 500 PRO + 20 ENTERPRISE.
> **Y3 ARR target**: ₹15 Cr ($1.8M) at 35K paying total.

---

### Slide 9 — Team

> **Girish Hiremath** — Founder, CEO/CTO
>
> - **14+ years enterprise software** across compliance, pharma, banking, fintech, telecom, IoT (Fortune 500)
> - **M.Tech in Data Science & AI** at **IIIT Dharwad** (Institute of National Importance) — Speech & NLP focus, started Mar 2026
> - **Principal Software Engineer** at a Compliance & RegTech company in Hyderabad (current)
> - **First production AI project in 2012**: Hindi Reader Android app (OpenCV + ANN) at a leading semiconductor company — Indic AI from day one of my career
> - Founder of **[IntelliForge AI](https://www.intelliforge.tech)** — Hyderabad-based AI engineering studio aligned with the Bharat AI Mission
> - 🌐 [girishbhiremath.vercel.app](https://girishbhiremath.vercel.app) · 🐙 [github.com/gengirish](https://github.com/gengirish)
>
> **Looking to hire post-YC**: 1 Indic NLP engineer (Bengaluru), 1 fullstack engineer, 1 mobile/PWA engineer, 1 vendor-success rep in Mumbai, 1 designer with vernacular UI experience. Two senior engineers from prior Fortune 500 work in active conversation as potential technical co-founder.
>
> **Why we'll win**:
> - Founder has shipped production software to **billion-dollar institutions** (banks, pharma, fintech) — not "first product"
> - **14-year Indic AI arc** — Hindi Reader (2012) → IIIT Dharwad Speech & NLP (2026) → AwaazOS (today)
> - **Production product on day 1 of YC**, not day 90 — see https://awaazos.vercel.app
> - **Maniacal focus** on the chai-wala, not the restaurant
> - **India-first defaults** baked into every line of code (see [ARCHITECTURE.md](./ARCHITECTURE.md))
> - **Bharat AI Mission alignment** — credibility + India-AI ecosystem access via IntelliForge AI's existing positioning

---

### Slide 10 — The ask

> Raising the **standard YC deal** ($500K).
>
> 12 months of runway gets us:
>
> - **10,000 paying vendors** at ₹4.5L MRR (₹54L ARR / ~$65K)
> - **3 engineers + 1 vendor-success + 1 designer** in Bengaluru/Mumbai
> - **City expansion** to Mumbai → Bengaluru → Hyderabad → Delhi NCR
> - **WhatsApp Business catalog commerce** as v2 revenue line
> - **Series A in Q1 2027** at ₹3 Cr ARR / $360K, targeting $5-8M raise
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

**A:** Two mitigations:
1. **Web Speech API covers en/hi for free** (Chrome / Edge / Samsung Browser native). That's ~60% of our addressable transcripts.
2. **Sarvam is one of three commercial Indic STT options** (Sarvam, AI4Bharat IndicWav2Vec hosted, Reverie Saaras). We architect with a `transcribeAudio()` interface in `lib/sarvam.ts` so we can swap providers in <1 week. The pricing risk is real but the lock-in is low.

### Q: What about offline mode? India has spotty internet.

**A:** Tier 1 + 2 cities (where 80% of our SAM is) have 4G coverage at the stall level. The remaining tier 3+ rural is a Phase 6 expansion that would need offline PWA + sync. Building it now is premature optimization.

### Q: GST? Most micro-merchants don't have GSTIN. What about the ones that do?

**A:** Pro plan adds a GST module: GSTIN field on Vendor, HSN code on MenuItem, GST-formatted invoice (CGST/SGST split, formatted bill number prefix). Not built yet — roadmapped for the kirana / restaurant tier (Pro & Enterprise). Most micro-merchants are below the ₹40L turnover threshold and stay GST-exempt.

### Q: Why ₹299, not ₹99?

**A:** Tested in informal interviews — vendors will pay ₹299 if the value is "you get back 15-20% in lost revenue from disputes". Below ₹299, perceived value drops sharply ("if it's only ₹99 it can't be serious"). Above ₹499, payment friction kicks in. ₹299 is the local maximum.

We will offer FREE for the first 50 monthly transactions to remove activation friction. Conversion to STARTER target: 25% within 60 days.

### Q: Single founder. Why?

**A:** Three honest reasons:

1. **Shipping velocity is already proven solo.** The production deploy at https://awaazos.vercel.app — full Next.js app + Auth.js + Prisma + Neon + Anthropic + Sarvam + Razorpay + Gupshup + Fly worker + 51 unit tests + 38 E2E tests — was built solo in 4 weekends. Most "co-founded" YC applicants at this stage have a Figma. We have a deploy.

2. **14 years of solo problem-solving across six industries** (banking / pharma / telecom / fintech / IoT / compliance) gave me the breadth to cover full-stack + DevOps + payments + AI without bottlenecks. The architecture document ([ARCHITECTURE.md](./ARCHITECTURE.md)) reflects 14 years of "doing it the hard way" in enterprise contexts.

3. **A technical co-founder conversation is open.** Two senior engineers from prior Fortune 500 work (one banking, one pharma) are in active conversation. If one of them joins in batch, great. If not, **first-month YC priority hire is a Bengaluru-based Indic NLP engineer** (IIIT/IIT alum) to deepen the Sarvam → Claude pipeline beyond what I can architect alone.

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
│  Vendor speaks order in their language → Sarvam STT + Claude     │
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
│  Production deployed today (Apr 2026). 0 users.                  │
│  20,825 LoC TypeScript. 51 unit tests + 38 E2E. 25 prod routes.  │
│  10 design partners onboarding in May. 500 vendors by Jul.       │
│                                                                  │
│  BUSINESS MODEL                                                  │
│  FREE (50 txn) → STARTER ₹299 → PRO ₹799 → ENTERPRISE custom.    │
│  CAC ₹160 · NRPM ₹3,290 · GM 78% · LTV/CAC 18× at M18.           │
│                                                                  │
│  TEAM                                                            │
│  Girish Hiremath — Founder, CEO/CTO                              │
│  14+ yrs enterprise eng (Fortune 500: banking, pharma, telecom)  │
│  M.Tech DSAI @ IIIT Dharwad — Speech & NLP focus                 │
│  First Indic AI project: Hindi Reader (OpenCV + ANN), 2012       │
│  Founder of IntelliForge AI — Bharat AI Mission aligned          │
│  girishbhiremath.vercel.app · github.com/gengirish               │
│                                                                  │
│  ASK                                                             │
│  Standard YC deal ($500K). 12 mo runway → 10K vendors,           │
│  ₹54L ARR, Series A target Q1 2027.                              │
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
> "Two-tier Claude with prompt caching saves 70% on inference. Atomic bill numbering inside `prisma.$transaction`. Tenant-scoped queries everywhere. BullMQ workers on Fly.io BOM. 51 unit tests + 38 E2E. Production today."

**3:30–4:30 — The why**
> "There are 25 million Rameshes. Existing POS doesn't fit them. Voice + UPI + WhatsApp is the first stack that does. We're 18 months from an incumbent shipping this. We'd like to be the ones who do — with YC."

**4:30–5:00 — Ask & close**
> "Standard YC deal. 12 months. 10K vendors. Series A at ₹3 Cr ARR.
>
> AwaazOS is built by **IntelliForge AI** — my Hyderabad-based AI engineering studio aligned with the Bharat AI Mission. AwaazOS is its Level-5 flagship — production proof that the studio ships shippable software, not slideware.
>
> **Bol. Bill. Becho.** Thank you."

---

## Part F — About the studio

**[IntelliForge AI](https://www.intelliforge.tech)** is the operating studio behind AwaazOS — a Hyderabad-based AI agent development and workflow automation company aligned with the **Bharat AI Mission** (India's ₹10,372 Cr IndiaAI initiative).

The studio operates a **5-Level AI framework** that takes a business from "AI-curious" to shipping production AI applications:

| Level | What it covers | AwaazOS expression |
| --- | --- | --- |
| 1 — AI Foundations & Training | Prompt engineering basics, AI literacy | (n/a) |
| 2 — AI Workflow Automation | n8n, Zapier, Make pipelines | Telemetry pipelines |
| 3 — AI Creative Studio | Image/video gen, content automation | (n/a) |
| 4 — AI Agent Development | Multi-agent systems, RAG, autonomous workers | **BullMQ workers** (`voiceLog` + `send-receipt`) on Fly.io BOM |
| **5 — AI App Development** | **Full production AI apps with auth, payments, scale** | **AwaazOS itself — Next.js 14 + Auth.js v5 + Neon + Anthropic + Razorpay + Gupshup, deployed across Vercel + Fly.io** |

Other IntelliForge AI projects:
- **Multi-Agent Deep Research** — autonomous research with citations (Level 4 + 5)
- **Interview Bot** — AI hiring platform with auth + RBAC
- **MoveMore** — AI-powered wellness and movement platform
- **AI Digital Profile** — talk-to-resume chatbot used by professionals
- **YouTube Transcript Scraper + Markdown→PDF Converter** — open utilities

> "Enterprise depth, startup speed."

**Contact:** contact@intelliforge.tech · **Site:** https://www.intelliforge.tech · **Location:** Hyderabad, Telangana, India

---

> Built for the chai-wala in Hyderabad, the dosa cart in Bengaluru, the kirana shop in Indore, the paan stall in Kolkata.
>
> Built by **Girish Hiremath · [IntelliForge AI](https://www.intelliforge.tech)**, aligned with the **Bharat AI Mission** 🇮🇳
>
> 🇮🇳 **AwaazOS — Bol. Bill. Becho.**
