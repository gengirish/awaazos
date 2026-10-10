import type { Metadata } from "next";

import { TRIAL_DAYS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Refund Policy — AwaazOS",
  description: "Refund and cancellation policy for AwaazOS subscriptions.",
};

export default function RefundPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p>Last updated: 10 October 2026</p>

      <h2>Free trial</h2>
      <p>
        The {TRIAL_DAYS}-day free trial needs no card and costs nothing. If you subscribe during the trial, you are
        not charged until it ends, and you can cancel before then without paying.
      </p>

      <h2>Monthly and yearly plans</h2>
      <p>
        Paid plans are billed in advance, monthly or yearly, with 18% GST added. You can cancel anytime from Billing
        settings. Cancellation stops future renewals; your plan stays active until the end of the period you have
        already paid for.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>
          Generally, subscription fees already billed are non-refundable, including the unused part of a yearly
          plan.
        </li>
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

