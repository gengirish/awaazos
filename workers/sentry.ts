/**
 * Sentry init for the BullMQ worker process (Fly.io). Imported once at the
 * top of workers/index.ts so failed jobs and uncaught errors get captured
 * under the same Sentry project as the Next.js app.
 *
 * Safe-by-default: zero-op if SENTRY_DSN is not configured.
 */
import * as Sentry from "@sentry/node";

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.FLY_APP_NAME || process.env.NODE_ENV || "development",
    release: process.env.FLY_RELEASE_VERSION || process.env.GIT_COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    serverName: process.env.FLY_MACHINE_ID || "awaazos-worker",
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
  });
}

export { Sentry };
