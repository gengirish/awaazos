import { Calculator } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { VendorSignOutButton } from "@/components/auth/VendorSignOutButton";
import { SettingsNav } from "@/components/settings/SettingsNav";

import { requireSettingsContext } from "./_context";

/**
 * Settings shell: a sidebar on md+ beside the page; on phones the hub
 * (/settings) is the list and each section page links back to it.
 * Auth is enforced by each page (requireVendorRole); the layout reads the
 * same (request-cached) context only to give Sign out the active vendor.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { vendor } = await requireSettingsContext();
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 md:px-6">
          <p className="min-w-0 truncate font-display text-base font-semibold text-foreground">
            AwaazOS<span className="hidden sm:inline"> settings</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/pos"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Calculator className="h-4 w-4" aria-hidden="true" />
              Back to POS
            </Link>
            <VendorSignOutButton variant="header" vendorId={vendor.id} storeName={vendor.name} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl gap-8 px-4 pb-10 pt-3 md:px-6 md:pt-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <SettingsNav />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 max-w-3xl flex-1 focus:outline-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
