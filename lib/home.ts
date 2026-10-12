/**
 * Where a signed-in vendor lands. Pure and client-safe.
 *
 * One rule, decided in one place (app/home/page.tsx, on Node, because it needs
 * the database — never in middleware, which must stay edge-safe):
 *
 *   setup not finished            → /onboarding
 *   storefront published          → /orders   (the day runs on online orders)
 *   everyone else (counter only)  → /pos      (also the only offline-capable page)
 *
 * Everything that used to pick a screen after auth — sign-in, sign-up, the end
 * of onboarding, the manifest's `start_url` — points at HOME_PATH instead. An
 * explicit `callbackUrl` or deep link never goes through here, so it still wins.
 *
 * Not routed through here: the "a cashier can't open this page" bounces on the
 * drops pages. Those are permission fallbacks, not landings, and stay on /pos
 * (a page every role can open, whatever the store's setup state).
 *
 * public/sw.js knows this path too (it has no build step, so the literal is
 * repeated there): opening the installed app with no network answers /home
 * with the cached /pos. lib/__tests__/push-sw.test.ts keeps the two in step.
 */
export const HOME_PATH = "/home";

export type HomeDestination = "/onboarding" | "/orders" | "/pos";

export type HomeInput = {
  /** `Vendor.onboardingDone`. */
  onboardingDone: boolean;
  /** `VendorSettings.publishStorefront`; a missing settings row counts as unpublished. */
  publishStorefront: boolean | null | undefined;
};

export function resolveHomePath(input: HomeInput): HomeDestination {
  if (!input.onboardingDone) return "/onboarding";
  return input.publishStorefront === true ? "/orders" : "/pos";
}
