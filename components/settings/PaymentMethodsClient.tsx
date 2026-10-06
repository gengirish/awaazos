"use client";

import { useState } from "react";

import { SettingsCard } from "@/components/settings/SettingsChrome";
import { PayOnDeliveryClient } from "@/components/settings/PayOnDeliveryClient";
import { UpiDetailsClient } from "@/components/settings/UpiDetailsClient";

/**
 * UPI details + pay on delivery share state: removing the UPI ID warns only
 * when pay on delivery is off, and the pay-on-delivery switch warns when there
 * is no UPI ID. Holding both here keeps the two warnings honest without a reload.
 */
export type PaymentMethodsClientProps = {
  initialUpiId: string | null;
  initialUpiName: string | null;
  initialAcceptPayOnDelivery: boolean;
  isOwner: boolean;
};

export function PaymentMethodsClient({
  initialUpiId,
  initialUpiName,
  initialAcceptPayOnDelivery,
  isOwner,
}: PaymentMethodsClientProps) {
  const [hasUpiId, setHasUpiId] = useState(Boolean(initialUpiId));
  const [payOnDelivery, setPayOnDelivery] = useState(initialAcceptPayOnDelivery);

  return (
    <>
      <SettingsCard
        title="UPI"
        description="Your UPI ID goes on the payment QR on your store page and at the counter."
      >
          <UpiDetailsClient
            initialUpiId={initialUpiId}
            initialUpiName={initialUpiName}
            acceptPayOnDelivery={payOnDelivery}
            isOwner={isOwner}
            onSaved={(id) => setHasUpiId(Boolean(id))}
          />
      </SettingsCard>

      <SettingsCard
        title="Pay on delivery"
        description="For online orders and Drops: let customers pay when they get their food."
      >
          <PayOnDeliveryClient
            initialAcceptPayOnDelivery={initialAcceptPayOnDelivery}
            hasUpiId={hasUpiId}
            onChange={setPayOnDelivery}
          />
      </SettingsCard>
    </>
  );
}
