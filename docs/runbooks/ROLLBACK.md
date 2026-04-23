# Rollback Runbook

## 1) Web/API rollback (Vercel)

### Fast rollback from dashboard

1. Open Vercel project `awaazos`.
2. Find previous known-good deployment.
3. Click **Promote to Production**.

### CLI rollback

1. List deployments:
   - `vercel ls`
2. Promote previous deployment:
   - `vercel promote <deployment-url-or-id>`

## 2) Worker rollback (Fly.io)

1. Check release history:
   - `flyctl releases -a awaazos-workers`
2. Roll back:
   - `flyctl releases rollback <version> -a awaazos-workers`
3. Verify worker logs:
   - `flyctl logs -a awaazos-workers`

## 3) Database rollback strategy

- Avoid destructive schema changes without migration review.
- For data issues:
  - Use Neon branch + point-in-time restore process from `DR_RESTORE.md`.
- For app-only regressions:
  - Prefer app rollback first; do not immediately roll DB backwards unless required.

## 4) Verification checklist

- `GET /api/health` = 200
- `GET /api/ready` = 200
- smoke flow works: sign-in -> POS -> transaction -> receipt enqueue
- `/api/_metrics` voice success and transaction counters moving

