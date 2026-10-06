import { Calculator } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SettingsNav } from "@/components/settings/SettingsNav";

/**
 * Settings shell: a sidebar on md+ beside the page; on phones the hub
 * (/settings) is the list and each section page links back to it.
 * Auth is enforced by each page (requireVendorRole), not here.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
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
          <p className="font-display text-base font-semibold text-foreground">AwaazOS settings</p>
          <Link
            href="/pos"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Calculator className="h-4 w-4" aria-hidden="true" />
            Back to POS
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl gap-8 px-4 pb-10 pt-3 md:px-6 md:pt-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <SettingsNav />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 max-w-3xl flex-1 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
