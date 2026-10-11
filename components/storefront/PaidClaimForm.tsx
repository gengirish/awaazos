"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const UTR = /^[A-Za-z0-9]{10,22}$/;

/**
 * Buyer tells the seller "I've paid". The UPI reference (UTR) is optional — it
 * just helps the seller find the payment. This only records the claim; the
 * seller answers "Payment received" or "Not received".
 *
 *   default            "I've paid" button + optional reference
 *   requireReference   after a "Not received": the reference is mandatory
 *   claimed            already claimed without a reference: offer to add one
 */
export function PaidClaimForm({
  slug,
  token,
  requireReference = false,
  claimed = false,
}: {
  slug: string;
  token: string;
  requireReference?: boolean;
  claimed?: boolean;
}) {
  const router = useRouter();
  const [upiRef, setUpiRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRef = requireReference || claimed;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const value = upiRef.replace(/\s+/g, "");
    if (needsRef && !value) {
      setError("Enter the 12-digit UPI reference (UTR) from your payment app.");
      return;
    }
    if (value && !UTR.test(value)) {
      setError("That doesn't look like a UPI reference. Check your payment app, or leave it empty.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value ? { upiRef: value } : {}),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else if (res.status === 409)
        setError("This order isn't waiting for payment any more. Refresh to see its status.");
      else if (data.error === "reference_required")
        setError("Enter the 12-digit UPI reference (UTR) from your payment app.");
      else if (res.status === 400) setError("That doesn't look like a UPI reference. Check your payment app.");
      else setError("Couldn't save that. Please try again.");
    } catch {
      setError("Couldn't reach the kitchen — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const buttonLabel = claimed ? "Add reference" : "I've paid";

  return (
    <form onSubmit={submit} className="space-y-3 text-left" noValidate>
      {!needsRef ? (
        <p className="text-center text-sm text-muted-foreground">Paid in your UPI app? Tell the kitchen.</p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="utr">
          UPI reference (UTR){" "}
          {needsRef ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Input
          id="utr"
          inputMode="text"
          autoComplete="off"
          value={upiRef}
          onChange={(e) => {
            setUpiRef(e.target.value);
            setError(null);
          }}
          maxLength={30}
          placeholder="12-digit UTR"
          aria-describedby="utr-hint"
          aria-invalid={error ? true : undefined}
          aria-required={needsRef || undefined}
          className="h-11 font-mono"
        />
        <p id="utr-hint" className="text-xs text-muted-foreground">
          {needsRef
            ? "Find it in your UPI app under the payment details."
            : "Find it in your UPI app under the payment details. It helps the kitchen spot your payment faster."}
        </p>
      </div>
      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-primary-foreground shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {buttonLabel}
      </button>
      {!claimed ? (
        <p className="text-center text-xs text-muted-foreground">
          The kitchen checks their UPI app and confirms. Tapping this does not mark the order paid.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
