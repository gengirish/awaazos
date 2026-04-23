# On-call Runbook

## Rotation model (current stage)

- Solo founder primary on-call (24x7 fallback).
- Escalation contacts:
  - Infra: Vercel/Fly support channels
  - Payments: Razorpay support
  - Messaging: Gupshup support
  - AI/STT: Anthropic + Sarvam status pages

## Daily checks (10 min)

1. Verify `GET /api/ready` is green.
2. Review Sentry unresolved errors.
3. Check worker logs for repeated failed jobs.
4. Check `/api/_metrics`:
   - voice success rate
   - receipt delivery rate
   - unusual transaction drop

## Alert routing

- Sentry critical errors -> immediate page
- Readiness monitor failures (2 consecutive) -> immediate page
- Queue failure spikes -> high-priority notification

## Escalation policy

- No ack in 5 minutes -> escalate to secondary contact.
- Incident unresolved in 30 minutes -> start rollback decision process.
- Customer-facing outage >10 minutes -> public status update.

