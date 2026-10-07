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

As of TODO.md §1.1 (checked 2026-10-05) the `awaazos-workers` app does not exist; these steps apply
once it is recreated.

Fly has no one-step rollback; redeploy the previous image.

1. Find the last good image:
   - `flyctl releases -a awaazos-workers --image`
2. Redeploy it (from the repo root, which holds the worker `fly.toml`):
   - `flyctl deploy -a awaazos-workers --image <image-ref>`
3. Verify worker logs:
   - `flyctl logs -a awaazos-workers`

## 3) Whisper STT rollback (Fly.io)

Self-hosted Whisper (`services/whisper-stt`, app `awaazos-whisper-stt`) is the last-resort STT hop.
It scales to zero (`min_machines_running = 0`), so the first request after idle is slow.

1. Find the last good image:
   - `flyctl releases -a awaazos-whisper-stt --image`
2. Redeploy it:
   - `flyctl deploy --config services/whisper-stt/fly.toml --image <image-ref>`
3. Verify:
   - `flyctl logs -a awaazos-whisper-stt`
   - `npm run smoke:whisper -- <path-to-audio> hi-IN`
4. To take it out of the cascade instead, unset `WHISPER_STT_URL` on Vercel and redeploy.

## 4) Database rollback strategy

- Avoid destructive schema changes. The repo applies schema with `prisma db push` and has no
  migration files, so a dropped column or table can't be brought back by redeploying older code.
- For data issues:
  - Use Neon branch + point-in-time restore process from `DR_RESTORE.md`.
- For app-only regressions:
  - Prefer app rollback first; do not immediately roll DB backwards unless required.

## 5) Verification checklist

- `GET /api/health` = 200
- `GET /api/ready` = 200
- smoke flow works: sign-in -> POS -> transaction -> "Send on WhatsApp" opens WhatsApp with the receipt
- `/admin/metrics` (platform ADMIN) loads and its 7-day paid-bill counts look normal

