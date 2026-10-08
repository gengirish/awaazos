/**
 * Registers /sw.js for the POS on page load (docs/PWA_OFFLINE_PLAN.md, Phase 0).
 *
 * Before the offline work the worker was only registered from push code
 * (lib/push-client.ts), so most devices never had one. Registering here never
 * asks for notification permission; push still subscribes only on opt-in.
 * Same URL and scope as lib/push-client.ts, so both share one registration.
 */
export function registerAppServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .getRegistration("/")
    .then((existing) => existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" }))
    .catch(() => {
      // Unsupported or blocked (private mode, some in-app browsers): the POS
      // still works online, it just can't open offline.
    });
}
