# Observability Setup

This document is the production setup guide for errors, logs, and uptime checks.

## 1) Sentry (App + API + Workers)

What is wired:

- Next.js browser runtime: `sentry.client.config.ts`
- Next.js server runtime: `sentry.server.config.ts`
- Next.js edge runtime: `sentry.edge.config.ts`
- Worker runtime: `workers/sentry.ts` + hooks in `workers/index.ts`

Required environment variables:

- `SENTRY_DSN` (server/workers)
- `NEXT_PUBLIC_SENTRY_DSN` (browser)

Optional:

- `SENTRY_TRACES_SAMPLE_RATE` (default `0.1`)
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (default `0.1`)
- `NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE` (default `0`)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for source map uploads

Notes:

- PII is disabled (`sendDefaultPii=false`).
- Request bodies and cookies are stripped in `beforeSend`.
- Known non-actionable errors (`rate_limited`, `plan_upgrade_required`) are ignored.

## 2) Structured logs

Structured JSON logs are emitted through `lib/logger.ts` with pino.

Key fields:

- `service`, `env`, `region`
- `requestId` (per-request correlation)
- Event-specific keys (`worker`, `jobId`, `vendorId`, etc.)

Redaction:

- Phone/email/password/session/cookie/authorization headers are redacted.

## 3) Health checks

Public probe endpoints:

- `GET /api/health`  -> liveness
- `GET /api/ready`   -> readiness (DB + Redis)

Expected:

- `200` on healthy state
- `/api/ready` returns `503` if any dependency is degraded

Recommended monitors:

- Ping `https://awaazos.vercel.app/api/ready` every 60s
- Alert on 2 consecutive failures

## 4) Internal metrics endpoint

Route: `GET /api/_metrics`

Auth:

- Requires platform `ADMIN`+ role

Returns:

- Vendor growth (`7d`, `30d`, total)
- Transactions (`today`, `24h`, revenue in paise)
- Voice quality (`successRate`, `escalationRate`, `lowConfidenceRate`)
- Voice latency (`p50`, `p95`, `p99`)
- Receipt delivery (`sent`, `deliveryRate`)

## 5) Vercel log drain

Recommended sink:

- Axiom, Better Stack, Datadog, or Elastic

Steps:

1. In Vercel Project -> Settings -> Logs -> Add Log Drain
2. Choose your provider and endpoint/token
3. Filter by `service=awaazos` to isolate app logs
4. Create alert rules:
   - `level=error` spikes
   - `route=/api/_metrics` with `voice.successRate < 0.80`
   - `event=worker_error` sustained over 5 minutes

## 6) Status page

Expose these checks:

- API readiness (`/api/ready`)
- Frontend home (`/`)
- Worker heartbeat (future H7 heartbeat route; currently infer via log activity)

Public incident labels:

- Partial outage: checkout/voice degraded
- Major outage: API unavailable

