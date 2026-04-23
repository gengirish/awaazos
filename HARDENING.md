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

- Rotate all secrets that were ever shared in chat history.
- Re-auth git (`gh auth login`) and push queued hardening commits.
- Deploy web + workers and run production E2E smoke suite.
- Enable branch protection checks in GitHub settings.
- Configure status page and alert channels from `docs/OBSERVABILITY.md`.

