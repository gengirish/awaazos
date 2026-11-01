import { referralSignUpPath } from "@/lib/referral";

/**
 * The quiet AwaazOS line at the bottom of the public pages a buyer sees
 * (/s/[slug], /s/[slug]/o/[token], /r/[token]). It doubles as the store's
 * referral link: "Start your own store" opens /sign-up?ref=<slug>, so a
 * seller who signs up from here gets the longer trial (lib/referral.ts).
 *
 * A server component with a plain anchor: no client JS, no tracking.
 * Demo stores are never referrers, so they keep the plain brand link.
 * Not for the staff print page /receipts/[bill] or its embed.
 */
export function PoweredByFooter({ slug, isDemo }: { slug: string | null | undefined; isDemo: boolean }) {
  const referral = !isDemo && slug ? referralSignUpPath(slug) : null;
  return (
    <a
      href={referral ?? "/"}
      rel="noopener"
      className="group inline-flex min-h-11 items-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* The anchor is the 44px tap target; the pill inside keeps its size. */}
      <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
        {referral ? "Powered by AwaazOS · Start your own store" : "Billing by AwaazOS — Bol. Bill. Becho."}
      </span>
    </a>
  );
}
