/**
 * Sentry client-side init. Loaded by @sentry/nextjs auto-instrumentation
 * on every page render in the browser.
 *
 * Safe-by-default: zero-op unless NEXT_PUBLIC_SENTRY_DSN is configured —
 * dev/CI builds without a DSN won't crash and won't ship phantom events.
 *
 * Sample rates tuned for an MVP B2B SaaS:
 *  - 10% performance trace sampling
 *  - 0% session replay by default; opt-in via SENTRY_REPLAY_SAMPLE_RATE
 *  - 100% replay on error (the case where replay is most valuable)
 */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? 0),
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // PII boundary: never ship customer phone / email / passwords to Sentry.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip request body & cookies from breadcrumbs as belt-and-braces.
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}
