# On-call Runbook

## Rotation model (current stage)

- Solo founder primary on-call (24x7 fallback).
- Escalation contacts:
  - Infra: Vercel/Fly support channels
  - Data: Neon (Postgres), Upstash (rate limits, idempotency, circuit breakers)
  - Payments: Razorpay support
  - AI: Anthropic status page
  - STT: OpenAI, Groq and Sarvam status pages; self-hosted Whisper is our own Fly app
    (`awaazos-whisper-stt`)
  - Email: AgentMail
  - Messaging: Gupshup, only for the dormant server-side receipt path (POS receipts use wa.me)

## Daily checks (10 min)

1. Verify `GET /api/ready` is green (one manual check; never automate it, it wakes Neon).
2. Review Sentry unresolved errors.
3. If the worker app is deployed, check its logs for repeated `job_failed` events.
4. Check `/admin/metrics` (platform ADMIN):
   - weekly active vendors and GMV, and their week-over-week change
   - share of paid bills that came from voice
   - an unusual drop in bills per vendor per day

## Alert routing

- Sentry critical errors -> immediate page
- Liveness monitor (`/api/health`) failures (2 consecutive) -> immediate page
- STT cascade exhaustion spikes (transcribe logs, `cascadeExhausted=true`) -> high-priority notification
- Worker `failed` events in Sentry (when the worker app is deployed) -> high-priority notification

## Escalation policy

- No ack in 5 minutes -> escalate to secondary contact.
- Incident unresolved in 30 minutes -> start rollback decision process.
- Customer-facing outage >10 minutes -> public status update.

