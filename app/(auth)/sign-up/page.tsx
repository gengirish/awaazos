import { Suspense } from "react";

import { PLAN_MARKETING } from "@/lib/plan-copy";
import { REFERRED_TRIAL_DAYS } from "@/lib/referral";

import { SignUpForm } from "./_components/SignUpForm";

export const metadata = { title: "Create your store · AwaazOS" };

/**
 * Server component so the call-to-action copy (lib/plan-copy.ts) is passed
 * down as strings and stays out of the form's client bundle. The form reads
 * `useSearchParams()`, which needs the <Suspense> boundary or `next build`
 * fails with the CSR-bailout error (see .cursor/rules/auth-rbac.mdc).
 */
export default function SignUpPage() {
  const { cta, ctaNote } = PLAN_MARKETING.STARTER;
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 p-4">
      <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
        {/* With a referral code the form swaps in the longer trial's label, so
            the button never says 30 days beside the 60-day note. */}
        <SignUpForm ctaLabel={cta} referredCtaLabel={`Start ${REFERRED_TRIAL_DAYS} days free`} ctaNote={ctaNote} />
      </Suspense>
    </main>
  );
}
