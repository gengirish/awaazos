# Production Hardening Summary

This document summarizes the production-hardening pass executed across H1-H7.

## Completed phases

- **H1 Security**
  - security headers (CSP, HSTS, XFO, XCTO, COOP, Permissions-Policy)
  - Redis-backed rate limits on auth/AI/webhooks/writes
  - Idempotency-Key on `POST /api/transactions`
  - password policy + common-password blocking

- **H2 Reliability**
  - `/api/health` and `/api/ready`
  - structured pino logger + request-id helpers
  - BullMQ retry/backoff defaults + graceful worker shutdown
  - upstream timeouts for Anthropic/Sarvam/Razorpay/Gupshup

- **H3 Observability**
  - Sentry integration for client/server/edge + workers
  - admin metrics endpoint: `GET /api/_metrics`
  - observability setup guide: `docs/OBSERVABILITY.md`

- **H4 Compliance**
  - legal pages (`/legal/privacy`, `/legal/terms`, `/legal/refund`, `/legal/dpdp-rights`)
  - cookie consent banner
  - DSR endpoint `DELETE /api/me` with owner-aware vendor cascade handling
  - retention worker (voice logs 90d, receipts 7y)
  - HSN/SAC exposed in menu + receipt output

- **H5 CI/CD Governance**
  - GitHub Actions CI (`lint + typecheck + unit + build + e2e + gitleaks + npm audit`)
  - Dependabot config
  - branch-protection policy doc
  - husky pre-commit + lint-staged

- **H6 Cost/Fairness**
  - vendor/global Anthropic token caps
  - vendor/global Sarvam minute caps
  - plan-tier AI throughput fairness
  - DB `statement_timeout` wrapper on heavy read endpoints

- **H7 Runbooks**
  - `docs/runbooks/INCIDENT_RESPONSE.md`
  - `docs/runbooks/ROLLBACK.md`
  - `docs/runbooks/DR_RESTORE.md`
  - `docs/runbooks/ON_CALL.md`

## Key operational endpoints

- Liveness: `GET /api/health`
- Readiness: `GET /api/ready`
- Platform metrics (ADMIN): `GET /api/_metrics`
- Retention run enqueue (ADMIN): `POST /api/admin/retention/run`
- User DSR deletion: `DELETE /api/me`

## Remaining operational checklist

- Rotate any secrets that were ever pasted in chat, email, or tickets (Upstash, Neon, Razorpay, etc.).
- Ensure **Vercel** has **`UPSTASH_REDIS_REST_URL`** + **`UPSTASH_REDIS_REST_TOKEN`** (REST API tab in Upstash). **`REDIS_URL`** on Vercel is only for BullMQ enqueue if you use a **public** TCP endpoint — not Fly `*.internal`.
- Ensure **Fly workers** have **`REDIS_URL`** (TCP `rediss://` or `redis://`) for BullMQ.
- Confirm **`GET /api/ready`** returns `200` with `redis` + `database` probes OK before investor demos.
- Keep **`git push`** working (`gh auth login` / `gh auth setup-git` if HTTPS token expires).
- Enable branch protection checks in GitHub settings (see `docs/BRANCH_PROTECTION.md`).
- Configure status page and alert channels from `docs/OBSERVABILITY.md`.
- Live demo walkthrough: `docs/DEMO_GUIDE.md`.

