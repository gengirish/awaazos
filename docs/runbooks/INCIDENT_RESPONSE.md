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
   - `GET /api/ready`
   - Sentry issue spikes
   - Vercel logs + Fly worker logs
4. If payments/billing are impacted, freeze risky deploys immediately.

## Triage checklist

- Is it frontend-only, API-only, worker-only, or shared dependency outage?
- Is Neon reachable?
- Is Redis reachable?
- Are third-party providers degraded (Anthropic/Sarvam/Razorpay/Gupshup)?
- Is rate-limiting rejecting legitimate traffic accidentally?

## Immediate mitigations

- Roll back latest Vercel deployment if error rate jumped after release.
- Scale/restart Fly workers if queues are stuck.
- Temporarily disable non-critical AI features behind plan gates if needed.
- Pause retention/admin background runs during active incident.

## Communication

- Internal updates every 15 min for SEV-1, every 30 min for SEV-2.
- Public status page update if customer-visible impact > 10 minutes.

## Resolution and follow-up

1. Confirm KPI recovery (`/api/_metrics`, queue depth, 5xx rate).
2. Close incident only after 30 minutes stable.
3. Write postmortem within 24 hours with:
   - Root cause
   - Detection gap
   - Corrective actions
   - Preventive actions and owners

