# docs/

Index of the operational and planning docs. Code wins wherever a doc disagrees with it.

## Repo root

| File | Purpose |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | Working conventions: commands, deploy topology, the two Redis surfaces, money, tenancy, PII |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | System diagrams, data model, ADRs |
| [`../TODO.md`](../TODO.md) | Open items, each with where the code is and how to verify it |

## Operations

| File | Purpose |
|---|---|
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Sentry, logs, health checks, `/admin/metrics`, log-drain alerts |
| [`runbooks/INCIDENT_RESPONSE.md`](runbooks/INCIDENT_RESPONSE.md) | Severity levels, first 10 minutes, triage, mitigations |
| [`runbooks/ON_CALL.md`](runbooks/ON_CALL.md) | Daily checks, alert routing, provider escalation contacts |
| [`runbooks/ROLLBACK.md`](runbooks/ROLLBACK.md) | Rolling back Vercel, the Fly worker app and the Fly Whisper app |
| [`runbooks/DR_RESTORE.md`](runbooks/DR_RESTORE.md) | Restoring Neon from point-in-time and re-pointing the apps |
| [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md) | Required status checks for `main` (whether protection is enabled is TODO 4.3) |
| [`DEMO_GUIDE.md`](DEMO_GUIDE.md) | Live demo walkthrough |
| [`../scripts/README.md`](../scripts/README.md) | Local smoke scripts for each STT provider, plus the PWA icon generator |
| [`../services/whisper-stt/README.md`](../services/whisper-stt/README.md) | Self-hosted Whisper ASR on Fly (`awaazos-whisper-stt`) |
| [`../tests/golden/parse-order/README.md`](../tests/golden/parse-order/README.md) | Golden parse-order harness (Claude regression + provider calibration) |
| [`../tests/golden/stt/README.md`](../tests/golden/stt/README.md) | Golden STT harness (gating a new ASR backend) |

## Plans (nothing applied unless the file says so)

| File | Purpose |
|---|---|
| [`CLEANUP_PLAN.md`](CLEANUP_PLAN.md) | Stale code, references and docs cleanup, with progress notes |
| [`CLERK_MIGRATION_PLAN.md`](CLERK_MIGRATION_PLAN.md) | Proposal to move vendor/staff auth from Auth.js to Clerk |
| [`PWA_OFFLINE_PLAN.md`](PWA_OFFLINE_PLAN.md) | Proposal for offline counter sales |

## Archive

[`archive/README.md`](archive/README.md): frozen April 2026 material (kickoff spec, generated course,
demo video script). None of it describes the current product.

## Production controls: where they live

A map of the hardening already in the code, so you can find it rather than re-add it.

| Control | Where |
|---|---|
| Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP) | `next.config.mjs` |
| Rate limits (auth, AI, webhooks, writes), backed by Upstash | `lib/ratelimit.ts` |
| `Idempotency-Key` on `POST /api/transactions` | `lib/idempotency.ts` |
| Password policy and common-password blocklist | `lib/password-strength.ts` |
| Per-provider STT circuit breakers and AI usage caps | `lib/circuit-breaker.ts`, `lib/ai-usage-guard.ts` |
| Upstream fetch timeouts | each provider module in `lib/` (`anthropic`, `sarvam`, `openai-stt`, `groq-stt`, `whisper-stt`, `razorpay`, `whatsapp`, `email`, `push`) |
| Postgres `statement_timeout` on heavy reads | `lib/db-timeout.ts`, used by the transaction list and CSV export |
| BullMQ retries/backoff and graceful worker shutdown | `lib/queues.ts`, `workers/index.ts` |
| Legal pages | `app/legal/{privacy,terms,refund,dpdp-rights}` |
| Cookie consent banner | `components/legal/CookieConsentBanner.tsx` |
| Self-service account deletion (DSR) | `DELETE /api/me` |
| Retention (voice logs 90 days, receipts 7 years) | `workers/retention.worker.ts`; enqueued only by `POST /api/admin/retention/run`, see TODO.md |
| CI, Dependabot, pre-commit | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.husky/` + `lint-staged` |

## Operational checklist

- Vercel needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (rate limits, idempotency,
  `/api/ready`). `REDIS_URL` on Vercel must be a public TCP endpoint, never a Fly `*.internal` host.
  See CLAUDE.md "Deploy topology".
- The Fly worker app needs `REDIS_URL` (TCP `rediss://`) for BullMQ.
- Rotate any secret that was ever pasted into chat, email or a ticket.
- Check `GET /api/ready` by hand before a demo. Don't put it on a poller (see OBSERVABILITY.md §3).
- Platform metrics are on `/admin/metrics` (platform `ADMIN`); see OBSERVABILITY.md §4.
