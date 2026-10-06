"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { isValidUpiId, normalizeUpiId, UPI_ID_FORMAT_MESSAGE } from "@/lib/upi";
import { cn } from "@/lib/utils";

/**
 * The stall's UPI ID and the name UPI apps show the customer. Both live on the
 * Vendor row and are saved through PATCH /api/vendor (owner only).
 */
export type UpiDetailsClientProps = {
  initialUpiId: string | null;
  initialUpiName: string | null;
  /** Current pay-on-delivery setting: decides whether removing the UPI ID needs a warning. */
  acceptPayOnDelivery: boolean;
  isOwner: boolean;
  /** Told after a successful save with the stored UPI ID (null when removed). */
  onSaved?: (upiId: string | null) => void;
};

type FieldErrors = { upiId?: string; upiName?: string };

const INPUT =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive";

export function UpiDetailsClient({
  initialUpiId,
  initialUpiName,
  acceptPayOnDelivery,
  isOwner,
  onSaved,
}: UpiDetailsClientProps) {
  const ids = useId();
  const upiIdHint = `${ids}-upi-id-hint`;
  const upiNameHint = `${ids}-upi-name-hint`;

  const [upiId, setUpiId] = useState(initialUpiId ?? "");
  const [upiName, setUpiName] = useState(initialUpiName ?? "");
  const [saved, setSaved] = useState({ upiId: initialUpiId ?? "", upiName: initialUpiName ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const nextUpiId = normalizeUpiId(upiId);
  const nextUpiName = upiName.trim();
  const dirty = nextUpiId !== saved.upiId || nextUpiName !== saved.upiName;
  const removing = nextUpiId === "" && saved.upiId !== "";
  const removeNeedsWarning = removing && !acceptPayOnDelivery;

  function save() {
    if (!dirty || pending || !isOwner) return;
    if (nextUpiId && !isValidUpiId(nextUpiId)) {
      setErrors({ upiId: UPI_ID_FORMAT_MESSAGE });
      return;
    }
    if (removeNeedsWarning && !confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ upiId: nextUpiId || null, upiName: nextUpiName || null }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const fieldErrors: FieldErrors = {
            upiId: data.details?.upiId?.[0],
            upiName: data.details?.upiName?.[0],
          };
          setErrors(fieldErrors);
          if (res.status === 403) toast.error("Only the owner can change this setting.");
          else toast.error(fieldErrors.upiId ?? fieldErrors.upiName ?? "Could not save. Please try again.");
          return;
        }
        setSaved({ upiId: nextUpiId, upiName: nextUpiName });
        setUpiId(nextUpiId);
        setUpiName(nextUpiName);
        setConfirmRemove(false);
        setJustSaved(true);
        onSaved?.(nextUpiId || null);
        toast.success(nextUpiId ? "UPI details saved." : "UPI ID removed.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  function onEdit() {
    setJustSaved(false);
    setConfirmRemove(false);
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change this.</p>}

      <div className="space-y-2">
        <label htmlFor={`${ids}-upi-id`} className="text-sm font-medium">
          UPI ID
        </label>
        <input
          id={`${ids}-upi-id`}
          name="upiId"
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@okaxis"
          value={upiId}
          disabled={!isOwner}
          onChange={(e) => {
            setUpiId(e.target.value);
            setErrors((p) => ({ ...p, upiId: undefined }));
            onEdit();
          }}
          aria-invalid={errors.upiId ? true : undefined}
          aria-describedby={upiIdHint}
          className={cn(INPUT, "font-mono")}
        />
        <p id={upiIdHint} className={cn("text-xs", errors.upiId ? "text-destructive" : "text-muted-foreground")}>
          {errors.upiId ?? "The ID customers pay to, like name@okaxis or 98xxxxxx10@ybl. Find it in your UPI app."}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${ids}-upi-name`} className="text-sm font-medium">
          Name shown on UPI apps <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id={`${ids}-upi-name`}
          name="upiName"
          type="text"
          autoComplete="off"
          maxLength={120}
          value={upiName}
          disabled={!isOwner}
          onChange={(e) => {
            setUpiName(e.target.value);
            setErrors((p) => ({ ...p, upiName: undefined }));
            onEdit();
          }}
          aria-invalid={errors.upiName ? true : undefined}
          aria-describedby={upiNameHint}
          className={INPUT}
        />
        <p id={upiNameHint} className={cn("text-xs", errors.upiName ? "text-destructive" : "text-muted-foreground")}>
          {errors.upiName ?? "Customers see this name before they pay. Leave empty to use your stall name."}
        </p>
      </div>

      {confirmRemove && removeNeedsWarning ? (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Pay on delivery is off, so without a UPI ID customers will have no way to pay you online. Tap
            &ldquo;Remove UPI ID&rdquo; again to confirm, or turn on pay on delivery below first.
          </p>
        </div>
      ) : null}

      {isOwner && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || pending}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : !dirty
                ? saved.upiId || saved.upiName
                  ? "Saved"
                  : "Save UPI details"
                : removing
                  ? "Remove UPI ID"
                  : "Save UPI details"}
          </button>
          <p role="status" aria-live="polite" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            {justSaved && !dirty ? (
              <>
                <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                Saved
              </>
            ) : null}
          </p>
        </div>
      )}
    </form>
  );
}
