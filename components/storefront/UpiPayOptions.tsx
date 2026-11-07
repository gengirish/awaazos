"use client";

import { Check, ChevronDown, ChevronRight, Copy, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { formatINR } from "@/lib/currency";
import { isAppleMobile, upiAmountText, upiAppLinks } from "@/lib/upi";
import { cn } from "@/lib/utils";

/**
 * Buyer-side "pay with a UPI app" controls, for a buyer looking at the page on
 * the phone they will pay from (a QR on that same screen can't be scanned).
 *
 * - Android: the generic `upi://pay` button opens the system chooser. Kept first.
 * - iPhone/iPad: `upi://` has no chooser and often opens nothing or a random
 *   app, so one row per app (`upiAppLinks`, same params) leads and the
 *   generic link is the last row, "Other UPI app".
 * - Everywhere: "Copy UPI ID" / "Copy amount" and a one-line manual route, the
 *   fallback that works with every UPI app. `foldFallback` tucks these (and
 *   `children`, more fallbacks) under one line, so the pay button stands alone.
 *
 * Platform detection runs in an effect, so the server render and the first
 * client render are identical (no hydration mismatch); iOS re-orders after
 * mount. Only the vendor's payee VPA and the order total are handled here —
 * no buyer data.
 */
export type UpiPayOptionsProps = {
  /** From `buildUpiDeepLink` / `buildUpiCollectLink`. */
  upiLink: string;
  upiId: string;
  /** Exact amount, when there is one. Omitted on the open-amount storefront QR. */
  amountPaise?: number | null;
  /** Label of the generic `upi://` button on Android / desktop. */
  genericLabel: string;
  /** Filled primary buttons (default) or outlined, when something else leads (Razorpay). */
  emphasis?: "primary" | "secondary";
  /** Hide the app-opening links from `sm` up (desktop has no UPI app to open). */
  linksMobileOnly?: boolean;
  /** Fold the fallbacks under "UPI app didn't open or showed a warning?". */
  foldFallback?: boolean;
  /** More fallbacks, shown after the manual route. */
  children?: React.ReactNode;
  className?: string;
};

type Copied = "upi" | "amount" | "failed" | null;

const FOCUS = "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export function UpiPayOptions({
  upiLink,
  upiId,
  amountPaise = null,
  genericLabel,
  emphasis = "primary",
  linksMobileOnly = false,
  foldFallback = false,
  children,
  className,
}: UpiPayOptionsProps) {
  const [ios, setIos] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);

  useEffect(() => {
    setIos(isAppleMobile(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const hasAmount = typeof amountPaise === "number" && amountPaise > 0;
  const amountLabel = hasAmount ? formatINR(amountPaise) : "";
  const apps = upiAppLinks(upiLink);

  async function copy(kind: "upi" | "amount") {
    const text = kind === "upi" ? upiId : upiAmountText(amountPaise ?? 0);
    setCopied((await copyText(text)) ? kind : "failed");
  }

  const filled = "bg-primary text-primary-foreground shadow-md hover:bg-primary/90";
  const outlined = "border border-primary/40 bg-background text-primary hover:bg-primary/5";

  const genericButton = (
    <a
      href={upiLink}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-6 text-base font-bold",
        FOCUS,
        emphasis === "primary" ? filled : outlined,
      )}
    >
      {genericLabel}
    </a>
  );

  // One row per app, as a picker: the app's initial in a tile, its name, a chevron.
  const appRowClass = cn(
    "flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 text-left text-base font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 motion-reduce:transition-none",
    emphasis === "primary" ? "border-primary/30" : "border-border",
    FOCUS,
  );
  const appTile =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-sm font-bold text-foreground";

  const appButtons = ios && apps.length > 0 ? (
    <div className="space-y-2 text-left">
      <p className="text-sm font-semibold text-muted-foreground">
        {hasAmount ? `Pay ${amountLabel} with` : "Open"}
      </p>
      <ul className="space-y-2">
        {apps.map((app) => (
          <li key={app.id}>
            <a
              href={app.href}
              aria-label={hasAmount ? `Pay ${amountLabel} with ${app.label}` : `Open ${app.label} to pay`}
              className={appRowClass}
            >
              <span className={appTile} aria-hidden="true">
                {app.label.charAt(0)}
              </span>
              <span className="flex-1">{app.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          </li>
        ))}
        <li>
          <a href={upiLink} className={appRowClass}>
            <span className={appTile} aria-hidden="true">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="flex-1">Other UPI app</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </div>
  ) : null;

  const copyButtonClass = cn(
    "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 motion-reduce:transition-none",
    FOCUS,
  );

  const fallback = (
    <>
      <div className={cn("grid gap-2", hasAmount ? "grid-cols-2" : "grid-cols-1")}>
        <button type="button" onClick={() => void copy("upi")} className={copyButtonClass}>
          {copied === "upi" ? (
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {copied === "upi" ? "UPI ID copied" : "Copy UPI ID"}
        </button>
        {hasAmount ? (
          <button type="button" onClick={() => void copy("amount")} className={copyButtonClass}>
            {copied === "amount" ? (
              <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            {copied === "amount" ? "Amount copied" : "Copy amount"}
          </button>
        ) : null}
      </div>

      {copied === "failed" ? (
        <p className="text-sm font-semibold text-destructive" aria-hidden="true">
          Couldn&apos;t copy. Select the UPI ID below and copy it by hand.
        </p>
      ) : null}
      <p className="select-all break-all font-mono text-sm text-foreground">{upiId}</p>
      <p className="text-sm text-muted-foreground">
        App didn&apos;t open, or warned the payment may fail? Open any UPI app → Pay to UPI ID → paste the UPI ID
        {hasAmount ? ", then the amount" : ""}.
      </p>
      {children}
    </>
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className={cn("space-y-3", linksMobileOnly && "sm:hidden")}>
        {appButtons ?? genericButton}
      </div>

      {foldFallback ? (
        <details className="group overflow-hidden rounded-xl border border-border/60 text-left">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <span className="flex-1">UPI app didn&apos;t open or showed a warning?</span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-3 border-t border-border/50 px-3 py-3">{fallback}</div>
        </details>
      ) : (
        fallback
      )}

      {/* Always mounted so screen readers announce the change. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copied === "upi"
          ? "UPI ID copied"
          : copied === "amount"
            ? `Amount ${amountLabel} copied`
            : copied === "failed"
              ? "Couldn't copy. Select the UPI ID below and copy it by hand."
              : ""}
      </p>
    </div>
  );
}
