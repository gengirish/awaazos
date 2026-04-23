/**
 * Next.js 14+ instrumentation entry. Auto-loaded by Next on server start.
 * Routes the runtime to the appropriate Sentry init file.
 *
 * Wired by next.config.mjs (no extra config needed since Next 13.4+).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
