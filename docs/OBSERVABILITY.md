# Observability Setup

Production setup guide for errors, logs, health checks and metrics. For the wider docs index see
[`README.md`](README.md).

`<prod-host>` below means the production domain. Which domain that is (`awaazos.vercel.app` or
`awaazos.intelliforge.tech`) is still an open question, tracked in `TODO.md` §5.

## 1) Sentry (App + API + Workers)

What is wired:

- Next.js browser runtime: `sentry.client.config.ts`
- Next.js server runtime: `sentry.server.config.ts`
- Next.js edge runtime: `sentry.edge.config.ts`
- Worker runtime: `workers/sentry.ts`, plus a `failed` handler on every BullMQ worker in
  `workers/index.ts`

Environment variables (Sentry stays a no-op without a DSN):

- `NEXT_PUBLIC_SENTRY_DSN` (browser; server, edge and workers fall back to it)
- `SENTRY_DSN` (server, edge, workers)

Optional:

- `SENTRY_TRACES_SAMPLE_RATE` (default `0.1`)
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (default `0.1`)
- `NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE` (default `0`)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for source map uploads (`next.config.mjs`)

Notes:

- PII is disabled (`sendDefaultPii=false`).
- Request bodies and cookies are stripped in `beforeSend`.
- Known non-actionable errors (`rate_limited`, `plan_upgrade_required`) are ignored on the server.

## 2) Logs

There are two log styles in the codebase, and a drain filter has to account for both.

**pino (`lib/logger.ts`).** JSON lines with `service: "awaazos"`, `env`, `region`, a string
`level`, and event-specific keys (`event`, `worker`, `jobId`, `vendorId`, …). Phone, email,
password, session and cookie/authorization fields are redacted. Used by:

- the Fly workers (`workers/*.ts`): events such as `workers_started`, `job_failed`,
  `worker_error`, `retention_run_complete`, `retention_failed`, `shutdown_*`;
- `POST /api/admin/retention/run`, `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`, `DELETE /api/me`, and `lib/email.ts`.

`lib/logger.ts` also exports `requestLogger()` / `newRequestId()` for per-request correlation, but
no route uses them yet, so there is no `requestId` field in practice.

**`console.*` (most API routes, including every hot path).** These lines have **no `service` or
`level` field**, so a `service=awaazos` filter misses them:

- `POST /api/ai/transcribe`: one `console.log(JSON.stringify(...))` line per request with
  `route: "/api/ai/transcribe"`, `vendorId`, `lang`, `sttSource`, `durationMs`, `attempts`
  (provider, ok, ms or reason), `success`, and `cascadeExhausted: true` when every provider failed.
- `POST /api/transactions`: `console.error(JSON.stringify(...))` with
  `event: "receipt_enqueue_failed"` when the post-sale receipt enqueue fails.
- Push, vendor payment keys and the Razorpay order webhook log JSON with an `event` key
  (`push_unsubscribed`, `vendor_payments_keys_saved`, `webhook_rzp_orders_unmatched`, …).
- `POST /api/ai/parse-order` and most other routes log plain-text `console.error` lines prefixed
  with the route, e.g. `[api/ai/parse-order] Claude parse failed`.

To see everything from the app, filter on the Vercel project (the drain's own source/project
field) rather than on `service`, and use the drain's level for `console.error` output.

## 3) Health checks

Probe endpoints:

- `GET /api/health`: liveness. No database, no Redis, no upstream calls.
- `GET /api/ready`: readiness. Runs `SELECT 1` on Neon and `PING` on Upstash (2 s timeout each).

The Redis probe uses `@upstash/redis` over HTTPS (`UPSTASH_REDIS_REST_URL` +
`UPSTASH_REDIS_REST_TOKEN`). It does not use the BullMQ `REDIS_URL` TCP connection, which is for the
Fly workers.

Expected:

- `200` when healthy.
- `/api/ready` returns `503` with `status: "degraded"` if any probe fails (e.g. missing `UPSTASH_*`
  env, database unreachable).

**Point uptime monitors at `/api/health` only.** Neon scales to zero when idle; a monitor that hits
`/api/ready` more often than Neon's idle timeout keeps the database awake around the clock and it
bills as if it were busy (each probe also costs an Upstash command). Use `/api/ready` by hand, after
a deploy, or before a demo.

Recommended monitor:

- Ping `https://<prod-host>/api/health` every 60 s.
- Alert on 2 consecutive failures.

## 4) Admin metrics page

Page: `/admin/metrics` (`app/admin/metrics/page.tsx`, queries in `lib/admin-metrics.ts`).

Auth: platform `ADMIN` or `SUPER_ADMIN`. The role is re-read from the database on each load (not
trusted from the JWT). Signed-in users below `ADMIN` get a 404; signed-out visitors are redirected
to `/sign-in` by the middleware.

It is an HTML page, not a JSON endpoint, and it emits no log lines, so it can't feed a log-drain
alert. Every load runs Prisma queries, so don't put it on a poller.

Shows, over rolling 7-day windows that start at IST midnight and count only `PAID` transactions:

- weekly active vendors (vendors with at least one paid bill);
- median bills per vendor per day;
- voice success rate: paid bills with `source = VOICE` ÷ all paid bills. This is the voice
  *adoption* share, not the parse or transcription success rate;
- weekly GMV;
- week-over-week change in active vendors and GMV.

There is no receipt-delivery rate, voice latency or escalation rate on it. For STT health use the
transcribe log lines in §2; parse-level telemetry goes to `VoiceParseLog` through the
`voice-parse-log` queue, which only fills when the Fly worker is running.

## 5) Vercel log drain

Recommended sink: Axiom, Better Stack, Datadog or Elastic.

Steps:

1. In Vercel Project -> Settings -> Logs -> Add Log Drain.
2. Choose your provider and endpoint/token.
3. Don't filter on `service=awaazos`: it drops every `console.*` line (§2).
4. Create alert rules:
   - error-level spikes (pino `level=error` plus `console.error` output);
   - `route=/api/ai/transcribe` with `cascadeExhausted=true` above a few per 15 minutes (vendors are
     falling back to tap input);
   - `event=receipt_enqueue_failed` (Redis unreachable from Vercel);
   - `event=worker_error` or `event=job_failed` sustained over 5 minutes, from the Fly worker logs.

As of TODO.md §1.1 (checked 2026-10-05) the Fly worker app `awaazos-workers` does not exist, so
there are no worker logs and nothing drains the BullMQ queues.

## 6) Status page

Expose these checks:

- API liveness (`/api/health`)
- Frontend home (`/`)

There is no worker heartbeat. Worker activity shows up only in the Fly logs.

Public incident labels:

- Partial outage: checkout/voice degraded
- Major outage: API unavailable
