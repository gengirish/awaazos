import type { Metadata } from "next";
import Link from "next/link";

import { OwnerSurveyForm } from "@/components/survey/OwnerSurveyForm";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Tell us what's hard — ${BRAND_NAME}`,
  description: "A short survey for home sellers on what slows your store down. No sign-in.",
  robots: { index: false, follow: false },
};

/** The owner survey as a shareable link, for sellers with no account. Rules in lib/owner-survey.ts. */
export default function PublicSurveyPage() {
  return (
    <div className="px-4 py-10 md:px-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-semibold text-balance text-foreground">Tell us what&apos;s hard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sell from home on Instagram or WhatsApp? A couple of minutes on what slows you down helps us build the right
          things next.
        </p>
        <div className="mt-6 rounded-lg border bg-card p-4 shadow-xs md:p-6">
          <OwnerSurveyForm answers={null} isPublic />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Already have a store on {BRAND_NAME}?{" "}
          <Link
            href="/settings/survey"
            className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
          >
            Answer in Settings
          </Link>
        </p>
      </div>
    </div>
  );
}
