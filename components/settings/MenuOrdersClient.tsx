"use client";

import type { FulfilmentMode } from "@prisma/client";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { paiseToRupees, rupeesToPaise } from "@/lib/currency";
import type { MenuOrdersBlocker } from "@/lib/menu-orders-board";
import { cn } from "@/lib/utils";

/**
 * "Order from menu": lets storefront buyers order the everyday menu at any
 * time (no Drop, no cut-off, no stock caps). Orders land on /orders.
 */
export type MenuOrdersClientProps = {
  slug: string;
  initialAcceptMenuOrders: boolean;
  initialFulfilmentMode: FulfilmentMode;
  initialDeliveryFeePaise: number;
  initialPickupNote: string | null;
  isOwner: boolean;
};

const MODES: { id: FulfilmentMode; label: string }[] = [
  { id: "PICKUP", label: "Pickup" },
  { id: "DELIVERY", label: "Delivery" },
  { id: "BOTH", label: "Both" },
];

/** Max delivery fee the API accepts: ₹1,000 (100000 paise). */
const MAX_FEE_PAISE = 100_000;

const BLOCKER_COPY: Record<MenuOrdersBlocker, { text: string; href: string; link: string }> = {
  storefront_not_published: {
    text: "Publish your storefront first, so customers have a page to order from.",
    href: "/settings/store",
    link: "Go to Online store",
  },
  no_payment_method: {
    text: "Customers need a way to pay. Add your UPI ID, or allow pay on delivery.",
    href: "/settings/payments",
    link: "Go to Payments",
  },
};

function paiseToInput(paise: number): string {
  return paise > 0 ? String(paiseToRupees(paise)) : "";
}

/** "" → 0, "30" / "12.50" → paise, anything else → null (invalid). */
function feeInputToPaise(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  try {
    const p = rupeesToPaise(Number(t));
    return p <= MAX_FEE_PAISE ? p : null;
  } catch {
    return null;
  }
}

export function MenuOrdersClient({
  slug,
  initialAcceptMenuOrders,
  initialFulfilmentMode,
  initialDeliveryFeePaise,
  initialPickupNote,
  isOwner,
}: MenuOrdersClientProps) {
  const [enabled, setEnabled] = useState(initialAcceptMenuOrders);
  const [blocker, setBlocker] = useState<MenuOrdersBlocker | null>(null);
  const [mode, setMode] = useState<FulfilmentMode>(initialFulfilmentMode);
  const [fee, setFee] = useState(paiseToInput(initialDeliveryFeePaise));
  const [note, setNote] = useState(initialPickupNote ?? "");
  const [saved, setSaved] = useState({
    mode: initialFulfilmentMode,
    fee: paiseToInput(initialDeliveryFeePaise),
    note: initialPickupNote ?? "",
  });
  const [feeError, setFeeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showFee = mode !== "PICKUP";
  const dirty = mode !== saved.mode || note.trim() !== saved.note || (showFee && fee.trim() !== saved.fee);
  const path = `/s/${slug}`;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409 && (data.error === "storefront_not_published" || data.error === "no_payment_method")) {
        setBlocker(data.error);
        toast.error(BLOCKER_COPY[data.error].text);
      } else if (res.status === 403) {
        toast.error("Only the owner can change this setting.");
      } else {
        toast.error("Could not save. Check the details and try again.");
      }
      return false;
    } catch {
      toast.error("Network error — please try again.");
      return false;
    }
  }

  function toggle(next: boolean) {
    if (pending) return;
    startTransition(async () => {
      if (await patch({ acceptMenuOrders: next })) {
        setEnabled(next);
        setBlocker(null);
        toast.success(next ? "Customers can now order from your menu." : "Menu ordering is off.");
      }
    });
  }

  function saveDetails() {
    const feePaise = showFee ? feeInputToPaise(fee) : null;
    if (showFee && feePaise === null) {
      setFeeError("Enter a fee between ₹0 and ₹1,000, like 30 or 25.50.");
      return;
    }
    setFeeError(null);
    const body: Record<string, unknown> = { menuFulfilmentMode: mode, menuPickupNote: note.trim() };
    if (showFee && feePaise !== null) body.menuDeliveryFeePaise = feePaise;
    startTransition(async () => {
      if (await patch(body)) {
        setSaved({ mode, fee: showFee && feePaise !== null ? paiseToInput(feePaise) : saved.fee, note: note.trim() });
        if (showFee && feePaise !== null) setFee(paiseToInput(feePaise));
        toast.success("Menu ordering details saved.");
      }
    });
  }

  const blockerCopy = blocker ? BLOCKER_COPY[blocker] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="menu-orders-toggle" className="text-sm font-medium">
            Let customers order from your menu anytime
          </label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Customers can order available menu items from your storefront. New orders show under Orders."
              : "Off. Customers can only see your menu (and order from open Drops)."}
          </p>
          <p className="text-xs text-muted-foreground">
            Hide single items from your store with &ldquo;Show online&rdquo; on the Menu page. Drops hide the
            everyday menu unless you tick &ldquo;Also show my everyday menu&rdquo;.
          </p>
          {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can change this.</p>}
        </div>
        <button
          id="menu-orders-toggle"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-describedby={blockerCopy ? "menu-orders-blocker" : undefined}
          onClick={() => toggle(!enabled)}
          disabled={pending || !isOwner}
          className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">{enabled ? "Turn off ordering from menu" : "Turn on ordering from menu"}</span>
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
              enabled ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </span>
        </button>
      </div>

      {blockerCopy && (
        <div
          id="menu-orders-blocker"
          role="alert"
          className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p>{blockerCopy.text}</p>
          <Link
            href={blockerCopy.href}
            className="mt-1 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            {blockerCopy.link}
          </Link>
        </div>
      )}

      {enabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="w-full break-all font-mono text-xs text-muted-foreground">{path}</p>
          <a
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open my store
          </a>
          <Link
            href="/orders"
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            See online orders
          </Link>
        </div>
      )}

      <fieldset className="space-y-2" disabled={!isOwner}>
        <legend className="text-sm font-medium">How customers get their order</legend>
        <div role="radiogroup" aria-label="How customers get their order" className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                mode === m.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      {showFee && (
        <div className="space-y-2">
          <label htmlFor="menu-delivery-fee" className="text-sm font-medium">
            Delivery fee (₹)
          </label>
          <input
            id="menu-delivery-fee"
            inputMode="decimal"
            autoComplete="off"
            value={fee}
            disabled={!isOwner}
            onChange={(e) => {
              setFee(e.target.value.replace(/[^\d.]/g, ""));
              setFeeError(null);
            }}
            placeholder="0"
            aria-invalid={feeError ? true : undefined}
            aria-describedby="menu-delivery-fee-hint"
            className="flex min-h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 font-mono text-base tabular-nums ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <p
            id="menu-delivery-fee-hint"
            className={cn("text-xs", feeError ? "text-destructive" : "text-muted-foreground")}
          >
            {feeError ?? "Added to delivery orders only. Leave empty for free delivery."}
          </p>
        </div>
      )}

      {mode !== "DELIVERY" && (
        <div className="space-y-2">
          <label htmlFor="menu-pickup-note" className="text-sm font-medium">
            Pickup note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="menu-pickup-note"
            rows={2}
            maxLength={200}
            value={note}
            disabled={!isOwner}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="menu-pickup-note-hint"
            className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {note.trim() === "" ? (
            /* Without this, a pickup buyer has no idea where or when to come. */
            <p
              id="menu-pickup-note-hint"
              className="rounded-md border border-amber-500/60 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <span className="font-semibold">Recommended:</span> Add where and when to collect, e.g.
              &ldquo;Stall 12, Exhibition Grounds · 5–9 pm&rdquo; — customers see this at checkout.
            </p>
          ) : (
            <p id="menu-pickup-note-hint" className="text-xs text-muted-foreground">
              Customers see this at checkout.
            </p>
          )}
        </div>
      )}

      {isOwner && (
        <button
          type="button"
          onClick={saveDetails}
          disabled={!dirty || pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && dirty ? "Saving…" : dirty ? "Save details" : "Saved"}
        </button>
      )}
    </div>
  );
}
