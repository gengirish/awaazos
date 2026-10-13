"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { formatIndianMobile, normaliseIndianMobile } from "@/lib/phone";
import { buyerWhatsappNumber } from "@/lib/storefront-order";

/**
 * The two opt-ins for showing the vendor's WhatsApp number publicly, both off
 * by default:
 * - `acceptWhatsappOrders`: buyers who placed an order get "send on WhatsApp"
 *   and "Message the kitchen".
 * - `showWhatsappOnStore`: every visitor of the store page gets a WhatsApp link.
 */
export type WhatsappOrdersClientProps = {
  initialWhatsappNumber: string | null;
  initialAcceptWhatsappOrders: boolean;
  initialShowOnStore: boolean;
  isOwner: boolean;
};

function usable(number: string): boolean {
  return buyerWhatsappNumber({ acceptWhatsappOrders: true, whatsappNumber: number }) !== null;
}

export function WhatsappOrdersClient({
  initialWhatsappNumber,
  initialAcceptWhatsappOrders,
  initialShowOnStore,
  isOwner,
}: WhatsappOrdersClientProps) {
  const [number, setNumber] = useState(formatIndianMobile(initialWhatsappNumber));
  const [savedNumber, setSavedNumber] = useState(initialWhatsappNumber ?? "");
  const [accept, setAccept] = useState(initialAcceptWhatsappOrders);
  const [showOnStore, setShowOnStore] = useState(initialShowOnStore);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normalised = normaliseIndianMobile(number);
  const numberDirty = normalised !== savedNumber;
  const disabled = !isOwner || pending;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "whatsapp_number_required") {
          setNumberError("Save a 10-digit mobile number first.");
          toast.error("Add your WhatsApp number before turning this on.");
        } else {
          toast.error(data.error ?? "Could not save.");
        }
        return false;
      }
      return true;
    } catch {
      toast.error("Network error — please try again.");
      return false;
    }
  }

  function saveNumber() {
    if (normalised && !usable(normalised)) {
      setNumberError("Enter a 10-digit mobile number.");
      return;
    }
    if (!normalised && (accept || showOnStore)) {
      setNumberError("Turn off both switches below before removing the number.");
      return;
    }
    setNumberError(null);
    startTransition(async () => {
      if (await patch({ whatsappNumber: normalised || null })) {
        setSavedNumber(normalised);
        setNumber(formatIndianMobile(normalised || null));
        toast.success(normalised ? "WhatsApp number saved." : "WhatsApp number removed.");
      }
    });
  }

  function toggle(next: boolean) {
    if (disabled) return;
    if (next && (!savedNumber || !usable(savedNumber))) {
      setNumberError("Save a 10-digit mobile number first.");
      return;
    }
    startTransition(async () => {
      if (await patch({ acceptWhatsappOrders: next })) {
        setAccept(next);
        toast.success(next ? "Customers can now send orders on WhatsApp." : "Your number is hidden from customers.");
      }
    });
  }

  function toggleShowOnStore(next: boolean) {
    if (disabled) return;
    if (next && (!savedNumber || !usable(savedNumber))) {
      setNumberError("Save a 10-digit mobile number first.");
      return;
    }
    startTransition(async () => {
      if (await patch({ showWhatsappOnStore: next })) {
        setShowOnStore(next);
        toast.success(
          next ? "Your store page now has a WhatsApp button." : "WhatsApp button removed from your store page.",
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="whatsapp-number" className="text-sm font-medium">
          WhatsApp number
        </label>
        <input
          id="whatsapp-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={number}
          disabled={disabled}
          onChange={(e) => {
            setNumber(e.target.value);
            setNumberError(null);
          }}
          aria-invalid={numberError ? true : undefined}
          aria-describedby="whatsapp-number-hint"
          className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base tabular-nums ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p
          id="whatsapp-number-hint"
          aria-live="polite"
          className={`text-xs ${numberError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {numberError ?? "The number customers message when they order. It can differ from your login phone."}
        </p>
        <button
          type="button"
          onClick={saveNumber}
          disabled={!numberDirty || disabled}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && numberDirty ? "Saving…" : numberDirty ? "Save number" : "Saved"}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="whatsapp-orders-toggle" className="text-sm font-medium">
            Let customers send orders on WhatsApp
          </label>
          <p className="text-xs text-muted-foreground">
            {accept
              ? "On: customers who place an order see this number and can message it to you on WhatsApp."
              : "Off: customers who order get no WhatsApp link to you."}
          </p>
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Customers who order will be able to see this phone number.
          </p>
        </div>
        <button
          id="whatsapp-orders-toggle"
          type="button"
          role="switch"
          aria-checked={accept}
          onClick={() => toggle(!accept)}
          disabled={disabled}
          className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">{accept ? "Turn off WhatsApp orders" : "Turn on WhatsApp orders"}</span>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              accept ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
                accept ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="whatsapp-store-toggle" className="text-sm font-medium">
            Show a WhatsApp button on your store page
          </label>
          <p className="text-xs text-muted-foreground">
            {showOnStore
              ? "On: your store page has a WhatsApp button that opens a chat with this number."
              : "Off: your store page has no WhatsApp button."}
          </p>
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Anyone who opens your store page will be able to see this phone number.
          </p>
        </div>
        <button
          id="whatsapp-store-toggle"
          type="button"
          role="switch"
          aria-checked={showOnStore}
          onClick={() => toggleShowOnStore(!showOnStore)}
          disabled={disabled}
          className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="sr-only">
            {showOnStore ? "Hide the WhatsApp button on your store page" : "Show a WhatsApp button on your store page"}
          </span>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              showOnStore ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${
                showOnStore ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>
      </div>
      {!isOwner ? <p className="text-xs text-muted-foreground">Only the owner can change this.</p> : null}
    </div>
  );
}
