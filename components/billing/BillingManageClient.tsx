"use client";

import type { Plan } from "@prisma/client";
import Link from "next/link";
import { useState } from "react";

import { PLAN_RANK } from "@/lib/constants";
import { Button } from "@/components/ui/button";

export function BillingManageClient({
  currentPlan,
  hasRazorpaySubscription,
}: {
  currentPlan: Plan;
  hasRazorpaySubscription: boolean;
}) {
  // HIDDEN — see PITCH.md "minimal product" cut list. Re-enable when STARTER GA.
  // Original pending union: null | "cancel" | "starter" | "pro".
  const [pending, setPending] = useState<null | "cancel" | "starter">(null);
  const [message, setMessage] = useState<string | null>(null);

  async function postJson(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as { error?: string; success?: boolean; shortUrl?: string };
    if (!res.ok) {
      setMessage(data.error ?? "Request failed.");
      return;
    }
    if (data.shortUrl) {
      window.location.href = data.shortUrl;
      return;
    }
    setMessage("Done. Refresh if your plan does not update immediately.");
    window.setTimeout(() => window.location.reload(), 800);
  }

  const belowStarter = PLAN_RANK[currentPlan] < PLAN_RANK.STARTER;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {belowStarter ? (
        <Button
          type="button"
          className="min-h-11"
          disabled={pending !== null}
          onClick={() => {
            setMessage(null);
            setPending("starter");
            void postJson("/api/razorpay/create-subscription", { plan: "STARTER" }).finally(() =>
              setPending(null),
            );
          }}
        >
          {pending === "starter" ? "Redirecting…" : "Upgrade to Starter"}
        </Button>
      ) : null}
      {/* HIDDEN — see PITCH.md "minimal product" cut list. Re-enable when STARTER GA.
      {belowPro ? (
        <Button
          type="button"
          className="min-h-11"
          disabled={pending !== null}
          onClick={() => {
            setMessage(null);
            setPending("pro");
            void postJson("/api/razorpay/create-subscription", { plan: "PRO" }).finally(() =>
              setPending(null),
            );
          }}
        >
          {pending === "pro" ? "Redirecting…" : "Upgrade to Pro"}
        </Button>
      ) : null}
      */}
      {hasRazorpaySubscription ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={pending !== null}
          onClick={() => {
            setMessage(null);
            setPending("cancel");
            void postJson("/api/razorpay/cancel-subscription").finally(() => setPending(null));
          }}
        >
          {pending === "cancel" ? "Cancelling…" : "Cancel subscription"}
        </Button>
      ) : null}
      <Button asChild variant="ghost" className="min-h-11">
        <Link href="/pricing">View pricing</Link>
      </Button>
      {message ? <p className="w-full text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
