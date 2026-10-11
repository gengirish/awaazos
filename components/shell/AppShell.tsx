import type { ReactNode } from "react";

import { AppRail, AppTabBar, type AppNavProps } from "@/components/shell/AppNav";

/** Target of the shell's skip link; wraps whatever page is showing. */
export const APP_CONTENT_ID = "app-content";

/**
 * Chrome for the signed-in vendor area: persistent navigation around every
 * page — a bottom tab bar on phones, a left rail from md up.
 *
 * Layout contract (app/globals.css, `.app-shell`):
 *   --app-tabbar-h      height of the tab bar; 0 at md+ and in print
 *   --app-rail-w        width of the rail; 0 below md and in print
 *   --app-bottom-inset  tab bar + cookie banner: the `bottom` offset for
 *                       anything sticky or fixed to the bottom of a page
 * The wrapper pads its content clear of both bars. Navigation carries
 * `.app-shell-chrome`, which print hides, so nothing of the shell reaches paper.
 *
 * Pages render their own <main>; the shell deliberately does not.
 */
export function AppShell({ children, ...nav }: AppNavProps & { children: ReactNode }) {
  return (
    <div className="app-shell min-h-dvh bg-background pb-[var(--app-tabbar-h)] pl-[var(--app-rail-w)]">
      <a
        href={`#${APP_CONTENT_ID}`}
        className="app-shell-chrome sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <AppRail {...nav} />
      <div id={APP_CONTENT_ID} tabIndex={-1} className="min-w-0 focus:outline-hidden">
        {children}
      </div>
      <AppTabBar {...nav} />
    </div>
  );
}
