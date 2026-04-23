"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type BillingTier = "FREE" | "STARTER" | "PRO";

export function PricingPlanButtons({
  tier,
  signedIn,
}: {
  tier: BillingTier;
  signedIn: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tier === "FREE") {
    return (
      <Button asChild className="min-h-11 w-full" variant="outline">
        <Link href="/sign-up">Start Free</Link>
      </Button>
    );
  }

  const plan = tier;
  const href = `/sign-up?intent=upgrade&plan=${plan}`;

  async function startCheckout() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/razorpay/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { shortUrl?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not start checkout.");
        return;
      }
      if (data.shortUrl) {
        window.location.href = data.shortUrl;
        return;
      }
      setError("Missing checkout URL.");
    } finally {
      setPending(false);
    }
  }

  if (!signedIn) {
    return (
      <Button asChild className="min-h-11 w-full">
        <Link href={href}>{tier === "STARTER" ? "Upgrade to Starter" : "Go Pro"}</Link>
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        type="button"
        className="min-h-11 w-full"
        disabled={pending}
        onClick={() => void startCheckout()}
      >
        {pending ? "Redirecting…" : tier === "STARTER" ? "Upgrade to Starter" : "Go Pro"}
      </Button>
      {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
