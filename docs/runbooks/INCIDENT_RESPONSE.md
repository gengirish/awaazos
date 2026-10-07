# Incident Response Runbook

## Severity levels

- **SEV-1**: Revenue blocked / data loss risk / production down
- **SEV-2**: Core feature degraded (voice parse, billing, receipt delivery)
- **SEV-3**: Non-critical defects or partial experience degradation

## First 10 minutes

1. Acknowledge alert and create incident thread.
2. Capture timestamp, impacted routes, and current deploy SHA.
3. Check:
   - `GET /api/health`
   - `GET /api/ready` (by hand; it wakes Neon)
   - Sentry issue spikes
   - Vercel logs + Fly logs (`awaazos-workers` if deployed, `awaazos-whisper-stt`)
4. If payments/billing are impacted, freeze risky deploys immediately.

## Triage checklist

- Is it frontend-only, API-only, worker-only, or shared dependency outage?
- Is Neon reachable?
- Is Redis reachable? (Vercel: **`UPSTASH_REDIS_*`** REST — rate limits & `/api/ready` probe; Fly: **`REDIS_URL`** TCP — BullMQ)
- Are third-party providers degraded?
  - Anthropic (order parsing)
  - STT: OpenAI and Groq (en/hi), Sarvam and Groq (te/kn/ta), then self-hosted Whisper on Fly
    (`awaazos-whisper-stt`) as the last resort. Each hop has its own circuit breaker; when all fail
    the vendor falls back to tap input
  - Razorpay (subscriptions and storefront checkout)
  - AgentMail (password-reset and buyer sign-in emails)
  - Web Push services (new-order alerts)
  - Gupshup, only on the dormant server-side receipt path (`POST /api/receipts/send` and the
    post-sale auto-enqueue); POS receipts go through wa.me
  - Upstash, Neon, Vercel, Fly
- Is rate-limiting rejecting legitimate traffic accidentally?

## Immediate mitigations

- Roll back latest Vercel deployment if error rate jumped after release.
- Scale/restart Fly workers if queues are stuck.
- Temporarily disable non-critical AI features behind plan gates if needed.
- Don't trigger a manual retention run (`POST /api/admin/retention/run`) during an incident.

## Communication

- Internal updates every 15 min for SEV-1, every 30 min for SEV-2.
- Public status page update if customer-visible impact > 10 minutes.

## Resolution and follow-up

1. Confirm recovery: 5xx rate and Sentry back to baseline, transcribe log lines show `success: true`
   again, queue depth falling if the worker app is deployed. `/admin/metrics` only shows 7-day
   aggregates, so it won't show a short incident.
2. Close incident only after 30 minutes stable.
3. Write postmortem within 24 hours with:
   - Root cause
   - Detection gap
   - Corrective actions
   - Preventive actions and owners

