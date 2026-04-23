import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy — AwaazOS",
  description: "Refund and cancellation policy for AwaazOS subscriptions.",
};

export default function RefundPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p>Last updated: 23 April 2026</p>

      <h2>Monthly plans</h2>
      <p>
        Paid plans are billed monthly in advance. You can cancel anytime from Billing settings. Cancellation stops
        future renewals.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>Generally, subscription fees already billed are non-refundable.</li>
        <li>Accidental duplicate charges are eligible for review and correction.</li>
        <li>Regulatory or legally required refunds will be honored.</li>
      </ul>

      <h2>How to request support</h2>
      <p>
        Contact support at contact@intelliforge.tech with your vendor ID, bill reference, and Razorpay transaction
        reference.
      </p>
    </>
  );
}

