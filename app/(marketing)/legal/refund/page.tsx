import type { Metadata } from "next";

import { BusinessDetails } from "@/components/legal/BusinessDetails";
import { SupportEmailLink } from "@/components/legal/SupportEmailLink";

import { TRIAL_DAYS } from "@/lib/constants";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Refund Policy — ${BRAND_NAME}`,
  description: `Refund and cancellation policy for ${BRAND_NAME} subscriptions.`,
};

export default function RefundPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p>Last updated: 08 November 2026</p>

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
        <li>
          Free months you earn by referring another seller while you are on a paid plan are given as a refund of your
          next charge through Razorpay (on a yearly plan, one twelfth of it for each month earned).
        </li>
        <li>Regulatory or legally required refunds will be honored.</li>
      </ul>

      <h2>Orders placed with a seller</h2>
      <p>
        This policy covers {BRAND_NAME} subscription fees only. If you bought something from a seller through its
        {BRAND_NAME} store, your payment went directly to that seller, and {BRAND_NAME} never received it. Please contact the
        seller to cancel an order or ask for a refund.
      </p>

      <h2>How to request support</h2>
      <p>
        Contact support at <SupportEmailLink /> with your vendor ID, bill reference, and Razorpay transaction
        reference.
      </p>
      <BusinessDetails />
    </>
  );
}

