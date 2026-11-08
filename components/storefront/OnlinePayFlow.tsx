"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { RazorpayPayButton } from "@/components/storefront/RazorpayPayButton";
import {
  directPayWasOpened,
  rememberDirectPayOpened,
  type DirectPayFallback,
} from "@/lib/storefront-direct-pay";

/**
 * The pay step of an order on a store that takes Razorpay: the Razorpay button,
 * with `directPay` (the UPI options) and `claim` ("Payment done?") kept back until
 * Razorpay fails or the buyer asks for them after closing its window. Both are
 * server-rendered and passed in.
 *
 * `startOpen` is for a buyer whose earlier claim the seller answered "Not received":
 * they may have paid directly and must be able to send a reference. A reload keeps
 * the options open through `directPayWasOpened`, read after mount so the server
 * HTML and the first client render match.
 *
 * `autoStart` opens Razorpay on arrival from checkout (`?pay=1`), so paying is one tap.
 */
export function OnlinePayFlow({
  slug,
  token,
  amountLabel,
  prefillName,
  prefillContact,
  fallback,
  startOpen,
  autoStart,
  heading,
  directPay,
  claim,
}: {
  slug: string;
  token: string;
  amountLabel: string;
  prefillName?: string | null;
  prefillContact?: string | null;
  fallback: DirectPayFallback;
  startOpen: boolean;
  autoStart: boolean;
  heading: ReactNode;
  directPay: ReactNode;
  claim: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    if (directPayWasOpened(token)) setOpen(true);
  }, [token]);

  const offerDirectPay = useCallback(() => {
    rememberDirectPayOpened(token);
    setOpen(true);
  }, [token]);

  return (
    <>
      <section aria-labelledby="pay-heading" className="space-y-4 p-4 sm:p-6">
        {heading}
        <RazorpayPayButton
          slug={slug}
          token={token}
          amountLabel={amountLabel}
          prefillName={prefillName}
          prefillContact={prefillContact}
          fallback={fallback}
          onOfferDirectPay={offerDirectPay}
          directPayOpen={open}
          autoStart={autoStart}
        />
        {open && fallback === "upi" ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            or pay directly with a UPI app
          </p>
        ) : null}
        {open ? directPay : null}
      </section>
      {open ? claim : null}
    </>
  );
}
