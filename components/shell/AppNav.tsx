"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@prisma/client";
import { ChevronRight, ExternalLink, MoreHorizontal } from "lucide-react";

import { VendorSignOutButton } from "@/components/auth/VendorSignOutButton";
import { InstallRailButton, InstallSheetRow } from "@/components/pwa/InstallPrompt";
import { APP_NAV_ICONS as ICONS } from "@/components/shell/nav-icons";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { appNavItemsForRole, isAppNavItemActive } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

export type AppNavProps = {
  /** The signed-in staff member's role at this vendor (`StaffMember.role`). */
  role: StaffRole;
  /** Active vendor; lets Sign out warn about this device's unsynced POS sales. */
  vendorId: string;
  vendorName: string;
  /** Public storefront path (`/s/<slug>`); null when the store isn't published. */
  storePath: string | null;
};

const FOCUS_RING =
  "ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * The current destination is marked three ways, never by colour alone:
 * `aria-current`, heavier text, and a bar on the edge of the tab.
 */
const TAB =
  "relative flex h-full min-h-11 w-full min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-xs transition-colors motion-reduce:transition-none ring-inset focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const TAB_ACTIVE =
  "font-bold text-foreground before:absolute before:inset-x-3 before:top-0 before:h-1 before:rounded-b-full before:bg-primary";
const TAB_IDLE = "font-medium text-muted-foreground hover:text-foreground";

const RAIL_ITEM =
  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-center text-xs transition-colors motion-reduce:transition-none";
const RAIL_ACTIVE =
  "bg-muted font-bold text-foreground before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary";
const RAIL_IDLE = "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground";

const SHEET_ROW =
  "flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-3 text-left ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

const NEW_TAB_NOTE = <span className="sr-only"> (opens in a new tab)</span>;

/**
 * Phone navigation (below md): a fixed bottom tab bar. The destinations that
 * don't fit live in a bottom sheet behind "More".
 *
 * The bar's height is `--app-tabbar-h` (app/globals.css, `.app-shell`); it
 * sits above the cookie banner while that is showing.
 */
export function AppTabBar({ role, vendorId, vendorName, storePath }: AppNavProps) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);

  const items = appNavItemsForRole(role);
  const tabs = items.filter((i) => i.placement === "tab");
  const more = items.filter((i) => i.placement === "more");
  const moreActive = more.some((i) => isAppNavItemActive(i.href, pathname));

  // A link in the sheet navigates: close it once the route has changed.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <nav
      aria-label="Main"
      data-testid="app-tabbar"
      className="app-shell-chrome fixed inset-x-0 bottom-[var(--cookie-banner-h,0px)] z-40 h-[var(--app-tabbar-h)] border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex h-full max-w-lg items-stretch">
        {tabs.map((item) => {
          const active = isAppNavItemActive(item.href, pathname);
          const Icon = ICONS[item.id];
          return (
            <li key={item.id} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(TAB, active ? TAB_ACTIVE : TAB_IDLE)}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-current={moreActive ? "page" : undefined}
                className={cn(TAB, moreActive ? TAB_ACTIVE : TAB_IDLE)}
              >
                <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate">More</span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] overflow-y-auto rounded-t-xl px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
            >
              <SheetHeader className="px-4 text-left">
                <SheetTitle>More</SheetTitle>
                <SheetDescription className="truncate">{vendorName}</SheetDescription>
              </SheetHeader>
              <nav aria-label="More" className="mt-3">
                <ul>
                  {more.map((item) => {
                    const active = isAppNavItemActive(item.href, pathname);
                    const Icon = ICONS[item.id];
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setMoreOpen(false)}
                          className={cn(SHEET_ROW, active && "bg-muted")}
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <span className={cn("min-w-0 flex-1 text-foreground", active ? "font-bold" : "font-semibold")}>
                            {item.label}
                          </span>
                          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                  {storePath ? (
                    <li>
                      <a
                        href={storePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMoreOpen(false)}
                        className={SHEET_ROW}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                          <ExternalLink className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 font-semibold text-foreground">
                          Live store
                          {NEW_TAB_NOTE}
                        </span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                    </li>
                  ) : null}
                  {/* "Install app" where this browser can install; nothing otherwise. */}
                  <InstallSheetRow rowClassName={SHEET_ROW} onPrompt={() => setMoreOpen(false)} />
                  <li className="mt-2 border-t border-border pt-2">
                    {/* Stays mounted while its "unsynced sales" warning is open, so the sheet is not closed on tap. */}
                    <VendorSignOutButton
                      variant="row"
                      vendorId={vendorId}
                      storeName={vendorName}
                      className="rounded-md"
                    />
                  </li>
                </ul>
              </nav>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}

/**
 * md+ navigation: a fixed left rail listing every destination (there is no
 * "More" here), with Live store and Sign out at the foot. Width is
 * `--app-rail-w` (app/globals.css, `.app-shell`).
 */
export function AppRail({ role, vendorId, vendorName, storePath }: AppNavProps) {
  const pathname = usePathname() ?? "";
  const items = appNavItemsForRole(role);

  return (
    <nav
      aria-label="Main"
      data-testid="app-rail"
      className="app-shell-chrome fixed bottom-[var(--cookie-banner-h,0px)] left-0 top-0 z-30 hidden w-[var(--app-rail-w)] flex-col border-r border-border bg-background md:flex"
    >
      <p className="px-2 pb-1 pt-4 text-center font-display text-sm font-semibold text-foreground">AwaazOS</p>
      <ul className="flex-1 space-y-1 overflow-y-auto px-1.5 py-2">
        {items.map((item) => {
          const active = isAppNavItemActive(item.href, pathname);
          const Icon = ICONS[item.id];
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(RAIL_ITEM, FOCUS_RING, active ? RAIL_ACTIVE : RAIL_IDLE)}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 border-t border-border px-1.5 py-2">
        {storePath ? (
          <a
            href={storePath}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(RAIL_ITEM, FOCUS_RING, RAIL_IDLE)}
          >
            <ExternalLink className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-w-full truncate">Live store</span>
            {NEW_TAB_NOTE}
          </a>
        ) : null}
        <InstallRailButton className={cn(RAIL_ITEM, FOCUS_RING, RAIL_IDLE)} />
        <VendorSignOutButton
          variant="header"
          vendorId={vendorId}
          storeName={vendorName}
          className={cn(RAIL_ITEM, RAIL_IDLE, "gap-1 border-0 bg-transparent")}
        />
      </div>
    </nav>
  );
}
