import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-awaaz-cream/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1 text-sm text-awaaz-charcoal/80">
          <p className="font-medium text-awaaz-charcoal">
            IntelliForge AI · Bharat AI Mission Aligned{" "}
            <span aria-hidden="true" className="ml-1">
              🇮🇳
            </span>
          </p>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} AwaazOS. All rights reserved.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href="#"
            className="min-h-11 min-w-[44px] content-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-none hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Privacy
          </Link>
          <Link
            href="#"
            className="min-h-11 min-w-[44px] content-center font-medium text-awaaz-charcoal/80 underline-offset-4 outline-none hover:text-awaaz-orange hover:underline focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
