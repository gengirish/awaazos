"use client";

import { Check, Copy } from "lucide-react";
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
 *   app, so one button per app (`upiAppLinks`, same params) leads and the
 *   generic link drops to "Other UPI app".
 * - Everywhere: "Copy UPI ID" / "Copy amount" and a one-line manual route, the
 *   fallback that works with every UPI app.
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
        emphasis === "primary" && !ios ? filled : outlined,
      )}
    >
      {ios ? "Other UPI app" : genericLabel}
    </a>
  );

  const appButtons = ios && apps.length > 0 ? (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">
        {hasAmount ? `Pay ${amountLabel} with` : "Open"}
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {apps.map((app) => (
          <li key={app.id}>
            <a
              href={app.href}
              aria-label={hasAmount ? `Pay ${amountLabel} with ${app.label}` : `Open ${app.label} to pay`}
              className={cn(
                "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-2 text-sm font-bold",
                FOCUS,
                emphasis === "primary" ? filled : outlined,
              )}
            >
              {app.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const copyButtonClass = cn(
    "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 motion-reduce:transition-none",
    FOCUS,
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className={cn("space-y-3", linksMobileOnly && "sm:hidden")}>
        {appButtons}
        {genericButton}
      </div>

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
        App didn&apos;t open? Open any UPI app → Pay to UPI ID → paste the UPI ID
        {hasAmount ? ", then the amount" : ""}.
      </p>

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
