/**
 * Sentry server-side init. Loaded by @sentry/nextjs on every API route /
 * RSC render in the Node.js runtime.
 */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    beforeSend(event) {
      // Defence-in-depth PII redaction. Mirrors lib/logger.ts redact paths.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    },
    ignoreErrors: [
      // BullMQ retries — already captured at "failed" handler with full ctx
      "gupshup_send_failed",
      // Rate-limit denials — these are by-design, not errors
      "rate_limited",
      // Plan-gate denials — by-design
      "plan_upgrade_required",
    ],
  });
}
