import Link from "next/link";

import { SupportEmailLink } from "@/components/legal/SupportEmailLink";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-awaaz-cream/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1 text-sm text-awaaz-charcoal/80">
          <p className="font-medium text-awaaz-charcoal">An IntelliForge AI product</p>
          {/* The shared link is a bare <a>: the 44px hit area is added here. */}
          <p className="[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-medium [&_a]:text-awaaz-charcoal [&_a]:underline [&_a]:underline-offset-4 [&_a]:outline-hidden [&_a]:hover:text-awaaz-orange [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-awaaz-orange [&_a]:focus-visible:ring-offset-2">
            Need help? Email <SupportEmailLink />
          </p>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AwaazOS. All rights reserved.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
        >
          <Link
            href="/legal/privacy"
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-hidden hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Privacy
          </Link>
          <Link
            href="/legal/terms"
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-hidden hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Terms
          </Link>
          <Link
            href="/legal/refund"
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-hidden hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Refunds
          </Link>
          <Link
            href="/legal/dpdp-rights"
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-hidden hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            DPDP rights
          </Link>
        </nav>
      </div>
    </footer>
  );
}
