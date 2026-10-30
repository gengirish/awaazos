"use client";

import { AlertCircle, ImagePlus, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downscaleImage } from "@/lib/image-downscale";
import { cn } from "@/lib/utils";

const UTR = /^[A-Za-z0-9]{10,22}$/;

/**
 * Buyer tells the seller "I've paid". The UPI reference (UTR) is optional — it
 * just helps the seller find the payment. This only records the claim; the
 * seller answers "Payment received" or "Not received".
 *
 *   default            "I've paid" button + optional reference
 *   requireReference   after a "Not received": the reference is mandatory
 *   claimed            already claimed: offer to add what is still missing
 *                      (`askReference`, `askScreenshot`); one of them is needed
 *
 * `askScreenshot` adds an optional payment screenshot (only when the private
 * store is configured, lib/payment-proof.ts). The claim is posted first, then
 * the image to …/payment-proof, which attaches it only to a claimed order. A
 * failed upload never undoes the claim: the form says so and the claimed-state
 * form on the refreshed page offers the screenshot again.
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
  askReference = true,
  askScreenshot = false,
}: {
  slug: string;
  token: string;
  requireReference?: boolean;
  claimed?: boolean;
  askReference?: boolean;
  askScreenshot?: boolean;
}) {
  const router = useRouter();
  const [upiRef, setUpiRef] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const needsRef = askReference && (requireReference || (claimed && !askScreenshot));
  const orderApi = `/api/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}`;

  function clearShot() {
    setShot(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Returns an error message, or null when the screenshot is attached. */
  async function uploadShot(file: File): Promise<string | null> {
    // UPI screenshots are tall phone screens; this keeps them well under 4 MB.
    const small = await downscaleImage(file, { maxWidth: 1080, maxHeight: 2400, type: "image/jpeg", quality: 0.8 });
    // Same cap as the server (IMAGE_MAX_BYTES, lib/blob-image.ts — server-only).
    if (small.size > 4 * 1024 * 1024) return "That image is too large. Send a screenshot of the payment instead.";
    const form = new FormData();
    form.append("file", small);
    try {
      const res = await fetch(`${orderApi}/payment-proof`, { method: "POST", body: form });
      if (res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 429) return "Too many uploads. Please wait a minute and try again.";
      if (res.status === 409) return "This order isn't waiting for payment any more.";
      if (res.status === 400 && data.error) return data.error;
      return "Couldn't upload the screenshot. Please try again.";
    } catch {
      return "Couldn't reach the store — check your connection and try again.";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const value = upiRef.replace(/\s+/g, "");
    if (claimed && !value && !shot) {
      setError(
        askReference && askScreenshot
          ? "Add the UPI reference or a screenshot of the payment."
          : askScreenshot
            ? "Choose a screenshot of the payment."
            : "Enter the 12-digit UPI reference (UTR) from your payment app.",
      );
      return;
    }
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
      // Already claimed and only adding a screenshot: no need to touch the claim.
      if (claimed && !value && shot) {
        const shotError = await uploadShot(shot);
        if (shotError) setError(shotError);
        else router.refresh();
        return;
      }
      const res = await fetch(`${orderApi}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value ? { upiRef: value } : {}),
      });
      if (res.ok) {
        if (shot) {
          const shotError = await uploadShot(shot);
          if (shotError) {
            // No refresh: it would swap this form out and hide the message.
            // Trying again re-sends the claim (harmless) and then the screenshot.
            setError(`The store knows you've paid, but the screenshot didn't go through. ${shotError}`);
            return;
          }
        }
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

  const buttonLabel = !claimed
    ? "I've paid"
    : askReference && askScreenshot
      ? "Send to the store"
      : askScreenshot
        ? "Send screenshot"
        : "Add reference";
  const errorBox = error ? (
    <p id="claim-error" role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </p>
  ) : null;

  return (
    <form onSubmit={submit} className="space-y-3 text-left" noValidate>
      {askReference ? (
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
            aria-describedby={error ? "claim-error utr-hint" : "utr-hint"}
            aria-invalid={error ? true : undefined}
            aria-required={needsRef || undefined}
            className="h-11 font-mono aria-invalid:border-destructive"
          />
          {errorBox}
          <p id="utr-hint" className="text-xs text-muted-foreground">
            {needsRef
              ? "Find it in your UPI app under the payment details."
              : "Find it in your UPI app under the payment details. It helps the store spot your payment faster."}
          </p>
        </div>
      ) : null}
      {askScreenshot ? (
        <div className="space-y-2">
          <p id="shot-label" className="text-sm font-medium leading-none">
            Payment screenshot <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          {/* The native input stays in the tab order (sr-only, not hidden) so the label works by keyboard. */}
          <input
            ref={fileRef}
            id="payment-shot"
            type="file"
            accept="image/*"
            className="peer sr-only"
            aria-labelledby="shot-label shot-pick"
            aria-describedby="shot-hint"
            onChange={(e) => {
              setShot(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          {shot ? (
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3">
              <ImagePlus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm">{shot.name || "Screenshot"}</span>
              <button
                type="button"
                onClick={clearShot}
                className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Remove screenshot</span>
              </button>
            </div>
          ) : (
            <label
              id="shot-pick"
              htmlFor="payment-shot"
              className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-background px-4 text-sm font-semibold text-primary hover:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2"
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Add screenshot
            </label>
          )}
          {askReference ? null : errorBox}
          <p id="shot-hint" className="text-xs text-muted-foreground">
            Only the store sees it, and it is deleted once they check your payment.
          </p>
        </div>
      ) : null}
      {askReference || askScreenshot ? null : errorBox}
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
