"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const UTR = /^[A-Za-z0-9]{10,22}$/;

/**
 * Buyer tells the seller "I've paid". The UPI reference (UTR) is optional — it
 * just helps the seller find the payment. This only records the claim; the
 * seller answers "Payment received" or "Not received".
 *
 *   default            "I've paid" button + optional reference
 *   requireReference   after a "Not received": the reference is mandatory
 *   claimed            already claimed without a reference: offer to add one
 *
 * "I've paid" is outlined: on the order page it is step 2, under the filled
 * pay button, and must not look like a second way to pay. The reference field
 * keeps `inputMode="text"` because the server accepts letters as well as digits
 * (`utrSubmitSchema`: 10–22 alphanumerics — some banks issue such references).
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
      else if (res.status === 409) {
        // The order moved on (paid, cancelled, expired): show where it stands now.
        setError("This order isn't waiting for payment any more. Tap “Check for update” above to see its status.");
        router.refresh();
      }
      else if (data.error === "reference_required")
        setError("Enter the 12-digit UPI reference (UTR) from your payment app.");
      else if (res.status === 400) setError("That doesn't look like a UPI reference. Check your payment app.");
      else setError("Couldn't save that. Please try again.");
    } catch {
      setError("Couldn't reach the store — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const buttonLabel = claimed ? "Add reference" : "I've paid";

  return (
    <form onSubmit={submit} className="space-y-3 text-left" noValidate>
      <div className="space-y-2">
        <Label htmlFor="utr">
          UPI reference (UTR){" "}
          {needsRef ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Input
          id="utr"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={upiRef}
          onChange={(e) => {
            setUpiRef(e.target.value);
            setError(null);
          }}
          maxLength={30}
          placeholder="12-digit UTR"
          aria-describedby={error ? "utr-error utr-hint" : "utr-hint"}
          aria-invalid={error ? true : undefined}
          aria-required={needsRef || undefined}
          className="h-11 font-mono aria-invalid:border-destructive"
        />
        {error ? (
          <p id="utr-error" role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <p id="utr-hint" className="text-xs text-muted-foreground">
          {needsRef
            ? "Find it in your UPI app under the payment details."
            : "Find it in your UPI app under the payment details. It helps the store spot your payment faster."}
        </p>
      </div>
      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className={cn(
          "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-base font-bold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60",
          claimed
            ? "bg-primary text-primary-foreground shadow-md"
            : "border border-primary/40 bg-background text-primary hover:bg-primary/5",
        )}
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        {buttonLabel}
      </button>
      {!claimed ? (
        <p className="text-center text-xs text-muted-foreground">
          The store checks its UPI app and confirms. Tapping this does not mark the order paid.
        </p>
      ) : null}
    </form>
  );
}
