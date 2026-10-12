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
 *
 * Session Replay is ~37 kB gzipped and used to sit in the JS every page loads
 * first — including the public storefront on a buyer's phone. It now arrives
 * in its own chunk once the page has loaded and the browser is idle. Error and
 * trace reporting are unchanged and start immediately; only an error in the
 * first moments of a page view is reported without a replay attached.
 */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Import the replay package itself rather than `Sentry.replayIntegration`:
 * any reference to the re-export in "@sentry/nextjs" (already in the main
 * chunk) lets the bundler keep replay there. `@sentry/replay` is the package
 * @sentry/browser re-exports it from (same version, installed with it); if it
 * ever stops resolving, the build fails rather than silently dropping replay.
 */
function addReplayWhenIdle(): void {
  const load = () => {
    import("@sentry/replay")
      .then(({ replayIntegration }) => {
        Sentry.addIntegration(
          replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          }),
        );
      })
      .catch(() => {
        // Chunk unavailable (offline, mid-deploy): errors are still reported, without a replay.
      });
  };
  // One-shot, after first paint work is done. Not a recurring timer.
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(load, { timeout: 5000 });
    } else {
      window.setTimeout(load, 2000);
    }
  };
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? 0),
    replaysOnErrorSampleRate: 1.0,
    // PII boundary: never ship customer phone / email / passwords to Sentry.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip request body & cookies from breadcrumbs as belt-and-braces.
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
  addReplayWhenIdle();
}
