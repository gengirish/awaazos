"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-awaaz-charcoal/90 outline-hidden transition-colors hover:text-awaaz-orange focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2";

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80 motion-reduce:transition-none",
        scrolled && "shadow-xs",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-xl font-bold tracking-tight text-awaaz-charcoal outline-hidden focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
        >
          AwaazOS
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          <Link href="/" className={navLinkClass}>
            Home
          </Link>
          <Link href="/#how-it-works" className={navLinkClass}>
            How it works
          </Link>
          <Link href="/pricing" className={navLinkClass}>
            Pricing
          </Link>
          <Link href="/sign-in" className={navLinkClass}>
            Sign in
          </Link>
          <Button
            asChild
            className="ml-2 min-h-11 bg-awaaz-orange px-5 font-semibold text-white hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            <Link href="/sign-up">Get Started</Link>
          </Button>
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 min-w-[44px] items-center justify-center rounded-md border border-awaaz-charcoal/20 px-3 text-sm font-medium text-awaaz-charcoal outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            Sign in
          </Link>
          <Button
            asChild
            className="min-h-11 shrink-0 bg-awaaz-orange px-4 font-semibold text-white hover:bg-awaaz-orange/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
          >
            <Link href="/sign-up">Get Started</Link>
          </Button>
        </div>
      </div>
      <nav
        aria-label="Mobile sections"
        className="flex gap-2 overflow-x-auto border-t border-border/50 px-4 py-2 md:hidden"
      >
        <Link
          href="/#how-it-works"
          className="shrink-0 rounded-full bg-muted px-3 py-2 text-xs font-medium text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
        >
          How it works
        </Link>
        <Link
          href="/pricing"
          className="shrink-0 rounded-full bg-muted px-3 py-2 text-xs font-medium text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
        >
          Pricing
        </Link>
      </nav>
    </header>
  );
}
