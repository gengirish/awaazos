"use client";

import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/currency";
import { orderErrorMessage, type OrderApiError } from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

/**
 * Shared buyer-side checkout pieces for the public storefront, used by both
 * DropOrder (pre-order batches) and MenuOrder (everyday menu): quantity
 * stepper, sticky cart bar, and the checkout sheet with remember-me, phone
 * normalisation, idempotent submit and error copy.
 *
 * The server is authoritative for price, stock and every limit. Nothing here
 * sends a price — callers build the request body from ids + quantities only.
 * Buyer details live only in this component's state and (opt-in) the device's
 * localStorage; they are never logged.
 */

export type FulfilmentType = "DELIVERY" | "PICKUP";
export type PaymentMethod = "UPI" | "CASH";

export type BuyerPrefill = {
  name: string | null;
  /** E.164 as stored (+91XXXXXXXXXX). */
  phone: string | null;
  address: string | null;
};

export type CheckoutLine = { id: string; name: string; priceInPaise: number; qty: number };

export type CheckoutDetails = {
  customerName: string;
  /** Normalised to E.164 when it looks like an Indian mobile; else as typed. */
  customerPhone: string;
  fulfilmentType: FulfilmentType;
  deliveryAddress: string | null;
  notes: string | null;
  paymentMethod: PaymentMethod;
};

/** "+919876543210" → "98765 43210" to match what the field expects. */
function phoneForField(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `${m[1]} ${m[2]}` : e164;
}

const STORAGE_KEY = "awz:storefront:buyer:v1";

type SavedBuyer = { name: string; phone: string; address: string };

function loadSavedBuyer(): SavedBuyer | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedBuyer>;
    return {
      name: typeof v.name === "string" ? v.name : "",
      phone: typeof v.phone === "string" ? v.phone : "",
      address: typeof v.address === "string" ? v.address : "",
    };
  } catch {
    return null;
  }
}

function saveBuyer(v: SavedBuyer | null): void {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked (private mode, quota) — remembering is a convenience only */
  }
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `k${Date.now()}${String(Math.random()).slice(2)}`;
  }
}

/** "98765 43210" / "+91 98765-43210" → "+919876543210"; anything else is sent as typed. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return raw.trim();
}

function looksLikeIndianMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local);
}

// ─── Quantity stepper ───────────────────────────────────────────────

/** "Add" button at 0, else 44×44 −/qty/+ group. */
export function QtyStepper({
  itemName,
  qty,
  max,
  onChange,
}: {
  itemName: string;
  qty: number;
  max: number;
  onChange: (qty: number) => void;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        disabled={max < 1}
        className="inline-flex min-h-11 min-w-[72px] items-center justify-center gap-1 rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
        aria-label={`Add ${itemName}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add
      </button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2" role="group" aria-label={`${itemName} quantity`}>
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`Remove one ${itemName}`}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-6 text-center font-mono text-base font-bold tabular-nums" aria-hidden="true">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40"
        aria-label={qty >= max ? `${itemName}: maximum reached` : `Add one more ${itemName}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ─── Cart bar ───────────────────────────────────────────────────────

/**
 * Sticky within its parent only, so a drop's bar and the menu's bar never
 * stack. Invisible (but keeps its space) while the cart is empty.
 */
export function CartBar({
  itemCount,
  subtotalPaise,
  canPay,
  onCheckout,
}: {
  itemCount: number;
  subtotalPaise: number;
  canPay: boolean;
  onCheckout: () => void;
}) {
  return (
    <div className={cn("sticky bottom-0 z-10 pb-3 pt-3", itemCount === 0 && "pointer-events-none")}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl bg-awaaz-charcoal px-4 py-3 text-white shadow-lg transition-opacity",
          itemCount === 0 && "opacity-0",
        )}
      >
        <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm" aria-live="polite" aria-atomic="true">
          {itemCount > 0 ? (
            <>
              <span className="font-semibold">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              <span className="mx-1.5 opacity-60">·</span>
              <span className="font-mono font-bold tabular-nums">{formatINR(subtotalPaise)}</span>
            </>
          ) : (
            <span className="sr-only">Cart is empty</span>
          )}
        </p>
        <button
          type="button"
          onClick={onCheckout}
          disabled={itemCount === 0 || !canPay}
          tabIndex={itemCount === 0 ? -1 : 0}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-charcoal disabled:opacity-50"
        >
          Checkout
        </button>
      </div>
    </div>
  );
}

/** Shown in place of a usable checkout when the vendor offers no payment path. */
export function NoPaymentNotice() {
  return (
    <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground">
      This kitchen hasn&apos;t set up online payment yet — message them to order.
    </p>
  );
}

// ─── Checkout sheet ─────────────────────────────────────────────────

export type CheckoutSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** POST target, e.g. `/api/s/<slug>/orders`. */
  endpoint: string;
  /** Unique per page — prefixes form control ids. */
  idPrefix: string;
  description: string;
  lines: CheckoutLine[];
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  pickupNote: string | null;
  payment: { upi: boolean; cod: boolean };
  prefill?: BuyerPrefill | null;
  /** Request body from the buyer's details — ids and quantities only, never prices. */
  buildBody: (details: CheckoutDetails) => Record<string, unknown>;
  /**
   * A 409-style business rejection. Apply any cart correction and return the
   * copy to show (usually `orderErrorMessage(err, itemName)`).
   */
  onRejected: (err: OrderApiError) => string;
};

export function CheckoutSheet(props: CheckoutSheetProps) {
  const {
    open,
    onOpenChange,
    slug,
    endpoint,
    idPrefix,
    description,
    lines,
    fulfilmentTypes,
    deliveryFeePaise,
    pickupNote,
    payment,
    prefill,
    buildBody,
    onRejected,
  } = props;
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [remember, setRemember] = useState(false);
  const [fulfilment, setFulfilment] = useState<FulfilmentType>(fulfilmentTypes[0] ?? "PICKUP");
  const [method, setMethod] = useState<PaymentMethod | null>(
    payment.upi ? "UPI" : payment.cod ? "CASH" : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKeyRef = useRef<string | null>(null);

  // Fresh sheet → no stale error from the previous attempt.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // Mount-only: prefill is server-rendered per request and must not clobber
  // what the buyer has typed if the page re-renders.
  const prefillRef = useRef(prefill);
  useEffect(() => {
    const saved = loadSavedBuyer();
    const p = prefillRef.current;
    if (saved) setRemember(true);
    setName(p?.name || saved?.name || "");
    setPhone(phoneForField(p?.phone ?? null) || saved?.phone || "");
    setAddress(p?.address || saved?.address || "");
  }, []);

  const subtotalPaise = sumPaise(lines.map((l) => l.priceInPaise * l.qty));
  const feePaise = fulfilment === "DELIVERY" ? deliveryFeePaise : 0;
  const totalPaise = subtotalPaise + feePaise;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!name.trim()) return setError("Please enter your name.");
    if (!looksLikeIndianMobile(phone)) return setError("Enter a valid 10-digit +91 mobile number.");
    if (fulfilment === "DELIVERY" && !address.trim()) return setError("Please enter a delivery address.");
    if (!method) return setError("Please choose how you'll pay.");
    if (lines.length === 0) return setError("Your cart is empty.");

    // One key per checkout attempt; reused only when the previous try never got
    // a response (network drop), so a retry can't create a second order.
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey();

    setSubmitting(true);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKeyRef.current,
        },
        body: JSON.stringify(
          buildBody({
            customerName: name.trim(),
            customerPhone: normalisePhone(phone),
            fulfilmentType: fulfilment,
            deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : null,
            notes: notes.trim() || null,
            paymentMethod: method,
          }),
        ),
      });
    } catch {
      setSubmitting(false);
      setError("Couldn't reach the kitchen — check your connection and try again.");
      return;
    }
    idemKeyRef.current = null;

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON — handled by status below */
    }

    if (res.status === 201) {
      const token = (json as { data?: { orderToken?: string } } | null)?.data?.orderToken;
      saveBuyer(remember ? { name: name.trim(), phone, address: address.trim() } : null);
      if (token) {
        router.push(`/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(token)}`);
        return; // keep the spinner while navigating
      }
    }
    setSubmitting(false);

    if (res.status === 429) return setError(orderErrorMessage({ error: "rate_limited" }));
    if (res.status === 404) return setError("This store isn't taking online orders right now.");
    if (res.status === 400) {
      const issue = (json as { issues?: { message?: string }[] } | null)?.issues?.[0]?.message;
      return setError(issue ?? orderErrorMessage({ error: "invalid_input" }));
    }

    const err = (json as OrderApiError | null) ?? { error: "unknown" };
    setError(onRejected(err));
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] max-w-2xl overflow-y-auto rounded-t-2xl px-4 pb-6 sm:px-6"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-xl">Checkout</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
          <ul className="space-y-1 rounded-xl bg-muted/50 px-3 py-2 text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {l.qty} × {l.name}
                </span>
                <span className="font-mono tabular-nums">{formatINR(l.priceInPaise * l.qty)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-name`}>Your name</Label>
            <Input
              id={`${idPrefix}-name`}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-phone`}>Mobile number</Label>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-11 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
                aria-hidden="true"
              >
                +91
              </span>
              <Input
                id={`${idPrefix}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={16}
                required
                aria-describedby={`${idPrefix}-phone-hint`}
                className="h-11"
              />
            </div>
            <p id={`${idPrefix}-phone-hint`} className="text-xs text-muted-foreground">
              The kitchen uses this to reach you about this order.
            </p>
          </div>

          {fulfilmentTypes.length > 1 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Delivery or pickup</legend>
              <div className="grid grid-cols-2 gap-2">
                {fulfilmentTypes.map((t) => (
                  <label
                    key={t}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                      fulfilment === t ? "border-primary bg-primary/10 text-primary" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${idPrefix}-fulfilment`}
                      value={t}
                      checked={fulfilment === t}
                      onChange={() => setFulfilment(t)}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {t === "DELIVERY"
                      ? deliveryFeePaise > 0
                        ? `Delivery (+${formatINRCompact(deliveryFeePaise)})`
                        : "Delivery"
                      : "Pickup"}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">
              {fulfilment === "DELIVERY" ? "Delivery only" : "Pickup only"}
            </p>
          )}

          {fulfilment === "DELIVERY" ? (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-address`}>Delivery address</Label>
              <textarea
                id={`${idPrefix}-address`}
                autoComplete="street-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                rows={3}
                required
                placeholder="Flat, building, street, landmark"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
              />
            </div>
          ) : pickupNote ? (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="font-semibold">Pickup: </span>
              {pickupNote}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-notes`}>Notes for the kitchen (optional)</Label>
            <Input
              id={`${idPrefix}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={280}
              placeholder="eggless, less spicy…"
              className="h-11"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Payment</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {payment.upi ? (
                <PaymentOption
                  name={`${idPrefix}-payment`}
                  checked={method === "UPI"}
                  onSelect={() => setMethod("UPI")}
                  label="Pay now by UPI"
                  hint="Any UPI app — you'll see a QR next"
                />
              ) : null}
              {payment.cod ? (
                <PaymentOption
                  name={`${idPrefix}-payment`}
                  checked={method === "CASH"}
                  onSelect={() => setMethod("CASH")}
                  label="Pay on delivery"
                  hint={fulfilment === "PICKUP" ? "Pay when you collect" : "Cash or UPI at the door"}
                />
              ) : null}
            </div>
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 accent-[hsl(var(--primary))]"
            />
            Remember my details on this device
          </label>

          <dl className="space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd className="font-mono tabular-nums">{formatINR(subtotalPaise)}</dd>
            </div>
            {feePaise > 0 ? (
              <div className="flex justify-between">
                <dt>Delivery fee</dt>
                <dd className="font-mono tabular-nums">{formatINR(feePaise)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-bold">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums" aria-live="polite">
                {formatINR(totalPaise)}
              </dd>
            </div>
          </dl>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || lines.length === 0}
            aria-busy={submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-bold text-primary-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            {submitting ? "Placing order…" : `Place order · ${formatINR(totalPaise)}`}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PaymentOption(props: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
        props.checked ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        onChange={props.onSelect}
        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{props.label}</span>
        <span className="text-xs text-muted-foreground">{props.hint}</span>
      </span>
    </label>
  );
}
