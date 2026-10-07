# Disaster Recovery / Restore Runbook

## RTO / RPO targets

- **RTO** (time to restore): 60 minutes
- **RPO** (acceptable data loss): <= 15 minutes (subject to Neon PITR granularity)

## Preconditions

- Neon project access with restore permissions
- Vercel + Fly deploy permissions
- Latest known-good app commit SHA

## Restore process (Neon PITR)

1. In Neon console, create a restore branch from a timestamp just before incident.
2. Validate restored branch data with sanity queries:
   - vendor count
   - transaction count for last 24h
   - latest receipt records
3. Swap app `DATABASE_URL`/`DIRECT_URL` to restored branch:
   - Vercel env update + redeploy
   - Fly secrets update + redeploy on the worker app (`awaazos-workers`), if it is deployed
     (TODO.md §1.1). The Whisper app (`awaazos-whisper-stt`) has no database access.
4. Run post-restore smoke tests.

## Verification

- `GET /api/ready` passes (DB + Upstash REST Redis; workers still need TCP `REDIS_URL`)
- POS create transaction works, and "Send on WhatsApp" opens WhatsApp with the receipt text
  (`GET /api/receipts/message`)
- If the worker app is deployed: BullMQ queues drain (`flyctl logs -a awaazos-workers`)
- `/admin/metrics` (platform ADMIN) shows the paid bills and GMV you expect for the last 7 days

## Post-restore actions

- Capture incident timeline and restore timestamp.
- Mark any potentially missing records after restore window.
- Notify impacted users if legally/contractually required.

