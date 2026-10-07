"use client";

import { AlertCircle, Clock, Loader2, MapPin, Minus, Plus, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatINR, sumPaise } from "@/lib/currency";
import { formatIndianMobile, normaliseIndianMobile } from "@/lib/phone";
import {
  CHECKOUT_FIELD_MESSAGES,
  checkoutErrorsFromIssues,
  checkoutFieldForErrorCode,
  firstInvalidField,
  orderErrorMessage,
  parseSavedBuyer,
  parseStoredCart,
  restoreCartLines,
  sameCartLines,
  serializeCart,
  validateCheckout,
  validateCheckoutField,
  type CheckoutField,
  type CheckoutFieldErrors,
  type CheckoutInput,
  type OrderApiError,
} from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

/**
 * Shared buyer-side checkout pieces for the public storefront, used by both
 * DropOrder (pre-order batches) and MenuOrder (everyday menu): quantity
 * stepper, sticky cart bar, device-local cart persistence, and the checkout
 * sheet with remember-me, phone normalisation, idempotent submit and
 * per-field error copy.
 *
 * The server is authoritative for price, stock and every limit. Nothing here
 * sends a price — callers build the request body from ids + quantities only.
 * Buyer details live only in this component's state and (opt-in) the device's
 * localStorage; they are never logged. The saved cart holds ids + quantities
 * only, never buyer details.
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

const STORAGE_KEY = "awz:storefront:buyer:v1";

function readSavedBuyerRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSavedBuyerRaw(raw: string | null): boolean {
  try {
    if (raw) window.localStorage.setItem(STORAGE_KEY, raw);
    else window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    /* storage blocked (private mode, quota) — remembering is a convenience only */
    return false;
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

// ─── Persisted cart ─────────────────────────────────────────────────

/**
 * Cart state mirrored to localStorage under `storageKey` (see
 * `cartStorageKey`). Restored after mount (never during render, so server and
 * client HTML match), re-validated with `maxFor` (null = item gone), and
 * discarded when stale or when `accepting` is false. Storage failures leave a
 * working in-memory cart.
 */
export function usePersistedCart(opts: {
  storageKey: string;
  /** false → the store no longer takes this cart (e.g. drop closed): discard it. */
  accepting: boolean;
  maxFor: (id: string) => number | null;
}): {
  cart: Record<string, number>;
  setCart: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  clearCart: () => void;
} {
  const { storageKey, accepting } = opts;
  const [cart, setCart] = useState<Record<string, number>>({});
  const restoredRef = useRef(false);
  const maxForRef = useRef(opts.maxFor);
  maxForRef.current = opts.maxFor;

  // Declared before the restore effect so the first commit never writes {}
  // over a saved cart.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const stored = parseStoredCart(window.localStorage.getItem(storageKey), Date.now());
      if (stored && sameCartLines(stored.lines, cart)) return; // keep its savedAt
      const raw = serializeCart(cart, Date.now());
      if (raw) window.localStorage.setItem(storageKey, raw);
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable — the in-memory cart still works */
    }
  }, [cart, storageKey]);

  useEffect(() => {
    restoredRef.current = true;
    try {
      if (!accepting) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      const stored = parseStoredCart(window.localStorage.getItem(storageKey), Date.now());
      const restored = stored ? restoreCartLines(stored.lines, maxForRef.current) : {};
      if (Object.keys(restored).length === 0) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      setCart(restored);
    } catch {
      /* storage unavailable — start with an empty cart */
    }
  }, [storageKey, accepting]);

  const clearCart = useCallback(() => {
    setCart({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { cart, setCart, clearCart };
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
  buttonRef,
}: {
  itemCount: number;
  subtotalPaise: number;
  canPay: boolean;
  onCheckout: () => void;
  /** The Checkout button — the sheet returns focus here when it closes. */
  buttonRef?: React.Ref<HTMLButtonElement>;
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
          ref={buttonRef}
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
  /** Where to collect, as the vendor wrote it. Never invented when absent. */
  pickupNote: string | null;
  /** When to collect (drops: the fulfilment window label), if known. */
  pickupWindow?: string | null;
  payment: { upi: boolean; cod: boolean };
  prefill?: BuyerPrefill | null;
  /** Focus goes back here when the sheet closes (the Checkout button). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Request body from the buyer's details — ids and quantities only, never prices. */
  buildBody: (details: CheckoutDetails) => Record<string, unknown>;
  /**
   * A 409-style business rejection. Apply any cart correction and return the
   * copy to show (usually `orderErrorMessage(err, itemName)`).
   */
  onRejected: (err: OrderApiError) => string;
  /** Order created — clear the saved cart before navigating away. */
  onOrdered?: () => void;
};

const SAVE_DEBOUNCE_MS = 400;
const PICKUP_FALLBACK = "The seller will confirm pickup details. You can message them after ordering.";

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
    pickupWindow,
    payment,
    prefill,
    returnFocusRef,
    buildBody,
    onRejected,
    onOrdered,
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
  const [fieldErrors, setFieldErrors] = useState<CheckoutFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: CheckoutField; n: number } | null>(null);
  const idemKeyRef = useRef<string | null>(null);

  const ids = {
    name: `${idPrefix}-name`,
    phone: `${idPrefix}-phone`,
    phoneHint: `${idPrefix}-phone-hint`,
    address: `${idPrefix}-address`,
    payment: `${idPrefix}-payment`,
    error: (f: CheckoutField) => `${idPrefix}-${f}-error`,
  };

  const input: CheckoutInput = { name, phone, address, fulfilment, method };

  // ── Remember my details ─────────────────────────────────────────────
  // Latest values for timers / event handlers that outlive a render.
  const latestRef = useRef({ name, phone, address, fulfilment, remember });
  latestRef.current = { name, phone, address, fulfilment, remember };
  const fulfilmentTypesRef = useRef(fulfilmentTypes);
  fulfilmentTypesRef.current = fulfilmentTypes;
  const loadedRef = useRef(false);
  const mountedAtRef = useRef(0);
  /** The raw entry this sheet last wrote — tells our writes apart from another sheet's. */
  const lastWriteRef = useRef<string | null>(null);

  const persistDetails = useCallback(() => {
    const v = latestRef.current;
    if (!loadedRef.current || !v.remember) return;
    const raw = JSON.stringify({
      name: v.name,
      phone: v.phone,
      address: v.address,
      fulfilment: v.fulfilment,
      savedAt: Date.now(),
    });
    if (writeSavedBuyerRaw(raw)) lastWriteRef.current = raw;
  }, []);

  const applySaved = useCallback(
    (saved: { name: string; phone: string; address: string; fulfilment: FulfilmentType | null }) => {
      setName(saved.name);
      setPhone(saved.phone);
      setAddress(saved.address);
      if (saved.fulfilment && fulfilmentTypesRef.current.includes(saved.fulfilment)) {
        setFulfilment(saved.fulfilment);
      }
    },
    [],
  );

  // Mount-only: prefill is server-rendered per request and must not clobber
  // what the buyer has typed if the page re-renders. Non-empty prefill fields
  // win over the device's remembered values.
  const prefillRef = useRef(prefill);
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const saved = parseSavedBuyer(readSavedBuyerRaw());
    const p = prefillRef.current;
    if (saved) setRemember(true);
    applySaved({
      name: p?.name || saved?.name || "",
      phone: formatIndianMobile(p?.phone ?? null) || saved?.phone || "",
      address: p?.address || saved?.address || "",
      fulfilment: saved?.fulfilment ?? null,
    });
    loadedRef.current = true;
  }, [applySaved]);

  // Ticked → save as the buyer types (debounced), so a reload keeps them.
  useEffect(() => {
    if (!loadedRef.current || !remember) return;
    const t = window.setTimeout(persistDetails, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [remember, name, phone, address, fulfilment, persistDetails]);

  // Flush the pending debounce when the tab is hidden or unloaded.
  useEffect(() => {
    window.addEventListener("pagehide", persistDetails);
    return () => window.removeEventListener("pagehide", persistDetails);
  }, [persistDetails]);

  function onRememberChange(checked: boolean) {
    setRemember(checked);
    if (!checked) {
      writeSavedBuyerRaw(null);
      lastWriteRef.current = null;
    } else {
      latestRef.current = { ...latestRef.current, remember: true };
      persistDetails();
    }
  }

  // Opening: fresh errors, and pick up details another sheet on this page
  // saved since we mounted. Closing: flush any pending save.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (!open) {
      persistDetails();
      return;
    }
    setFieldErrors({});
    setFormError(null);
    const raw = readSavedBuyerRaw();
    if (raw === lastWriteRef.current) return;
    const saved = parseSavedBuyer(raw);
    if (saved && saved.savedAt >= mountedAtRef.current) {
      setRemember(true);
      applySaved(saved);
      lastWriteRef.current = raw;
    } else if (!saved && lastWriteRef.current !== null) {
      // Another sheet unticked "remember" after we saved.
      setRemember(false);
      lastWriteRef.current = null;
    }
  }, [open, persistDetails, applySaved]);

  // ── Errors and focus ────────────────────────────────────────────────

  /** Clears a field's error once an edit makes it valid; never adds one mid-typing. */
  function revalidate(field: CheckoutField, patch: Partial<CheckoutInput>) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      if (validateCheckoutField(field, { ...input, ...patch })) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function showFieldErrors(errors: CheckoutFieldErrors) {
    setFieldErrors(errors);
    const first = firstInvalidField(errors);
    if (first) setFocusRequest((r) => ({ field: first, n: (r?.n ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!focusRequest) return;
    let el: HTMLElement | null = null;
    if (focusRequest.field === "payment") {
      const group = document.getElementById(ids.payment);
      el =
        group?.querySelector<HTMLElement>("input[type=radio]:checked") ??
        group?.querySelector<HTMLElement>("input[type=radio]") ??
        null;
    } else {
      el = document.getElementById(ids[focusRequest.field]);
    }
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
    // ids derive from idPrefix only; the request object is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  function describedBy(field: CheckoutField, ...extra: string[]): string | undefined {
    const all = [...extra, fieldErrors[field] ? ids.error(field) : null].filter(Boolean);
    return all.length > 0 ? all.join(" ") : undefined;
  }

  const subtotalPaise = sumPaise(lines.map((l) => l.priceInPaise * l.qty));
  const feePaise = fulfilment === "DELIVERY" ? deliveryFeePaise : 0;
  const totalPaise = subtotalPaise + feePaise;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors = validateCheckout(input);
    showFieldErrors(errors);
    if (firstInvalidField(errors)) return;
    if (lines.length === 0) return setFormError("Your cart is empty.");

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
            customerPhone: normaliseIndianMobile(phone),
            fulfilmentType: fulfilment,
            deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : null,
            notes: notes.trim() || null,
            paymentMethod: method ?? "UPI",
          }),
        ),
      });
    } catch {
      setSubmitting(false);
      setFormError("Couldn't reach the kitchen — check your connection and try again.");
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
      if (remember) persistDetails();
      else writeSavedBuyerRaw(null);
      onOrdered?.();
      if (token) {
        router.push(`/s/${encodeURIComponent(slug)}/o/${encodeURIComponent(token)}`);
        return; // keep the spinner while navigating
      }
    }
    setSubmitting(false);

    if (res.status === 429) return setFormError(orderErrorMessage({ error: "rate_limited" }));
    if (res.status === 404) return setFormError("This store isn't taking online orders right now.");
    if (res.status === 400) {
      const issues = (json as { issues?: { message?: string }[] } | null)?.issues;
      const mapped = checkoutErrorsFromIssues(issues);
      if (mapped) return showFieldErrors(mapped);
      return setFormError(issues?.[0]?.message ?? orderErrorMessage({ error: "invalid_input" }));
    }

    const err = (json as OrderApiError | null) ?? { error: "unknown" };
    const message = onRejected(err);
    const field = checkoutFieldForErrorCode(err.error);
    if (field && (field !== "address" || fulfilment === "DELIVERY")) {
      return showFieldErrors({ ...fieldErrors, [field]: message });
    }
    setFormError(message);
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92vh] max-w-2xl overflow-y-auto rounded-t-2xl px-4 pb-6 sm:px-6"
        onCloseAutoFocus={(e) => {
          const target = returnFocusRef?.current;
          if (target && target.isConnected) {
            e.preventDefault();
            target.focus();
          }
        }}
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
            <Label htmlFor={ids.name}>Your name</Label>
            <Input
              id={ids.name}
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                revalidate("name", { name: e.target.value });
              }}
              maxLength={80}
              required
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={describedBy("name")}
              className="h-11 scroll-my-24 aria-[invalid=true]:border-destructive"
            />
            <FieldError id={ids.error("name")} message={fieldErrors.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={ids.phone}>Mobile number</Label>
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-11 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
                aria-hidden="true"
              >
                +91
              </span>
              <Input
                id={ids.phone}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  revalidate("phone", { phone: e.target.value });
                }}
                maxLength={16}
                required
                aria-invalid={fieldErrors.phone ? true : undefined}
                aria-describedby={describedBy("phone", ids.phoneHint)}
                className="h-11 scroll-my-24 aria-[invalid=true]:border-destructive"
              />
            </div>
            <FieldError id={ids.error("phone")} message={fieldErrors.phone} />
            <p id={ids.phoneHint} className="text-xs text-muted-foreground">
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
                      onChange={() => {
                        setFulfilment(t);
                        revalidate("address", { fulfilment: t });
                      }}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {t === "DELIVERY"
                      ? deliveryFeePaise > 0
                        ? `Delivery (+${formatINR(deliveryFeePaise)})`
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
              <Label htmlFor={ids.address}>Delivery address</Label>
              <textarea
                id={ids.address}
                autoComplete="street-address"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  revalidate("address", { address: e.target.value });
                }}
                maxLength={500}
                rows={3}
                required
                placeholder="Flat, building, street, landmark"
                aria-invalid={fieldErrors.address ? true : undefined}
                aria-describedby={describedBy("address")}
                className="flex w-full scroll-my-24 rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive md:text-sm"
              />
              <FieldError id={ids.error("address")} message={fieldErrors.address} />
            </div>
          ) : (
            <div className="space-y-1.5 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {pickupNote ? (
                  <span>
                    <span className="font-semibold">Pickup: </span>
                    {pickupNote}
                  </span>
                ) : (
                  <span>{PICKUP_FALLBACK}</span>
                )}
              </p>
              {pickupWindow ? (
                <p className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">When: </span>
                    {pickupWindow}
                  </span>
                </p>
              ) : null}
            </div>
          )}

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

          <fieldset
            id={ids.payment}
            aria-invalid={fieldErrors.payment ? true : undefined}
            aria-describedby={describedBy("payment")}
            className="space-y-2"
          >
            <legend className="text-sm font-medium">Payment</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {payment.upi ? (
                <PaymentOption
                  name={`${idPrefix}-payment`}
                  checked={method === "UPI"}
                  onSelect={() => {
                    setMethod("UPI");
                    revalidate("payment", { method: "UPI" });
                  }}
                  label="Pay now by UPI"
                  hint="Any UPI app — you'll see a QR next"
                  invalid={!!fieldErrors.payment}
                  describedBy={describedBy("payment")}
                />
              ) : null}
              {payment.cod ? (
                <PaymentOption
                  name={`${idPrefix}-payment`}
                  checked={method === "CASH"}
                  onSelect={() => {
                    setMethod("CASH");
                    // A pay_on_delivery_disabled rejection stays until they pick UPI.
                    setFieldErrors((prev) => {
                      if (prev.payment !== CHECKOUT_FIELD_MESSAGES.payment) return prev;
                      const next = { ...prev };
                      delete next.payment;
                      return next;
                    });
                  }}
                  label="Pay on delivery"
                  hint={fulfilment === "PICKUP" ? "Pay when you collect" : "Cash or UPI at the door"}
                  invalid={!!fieldErrors.payment}
                  describedBy={describedBy("payment")}
                />
              ) : null}
            </div>
            <FieldError id={ids.error("payment")} message={fieldErrors.payment} />
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => onRememberChange(e.target.checked)}
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

          {/* Order-level problems only (stock, cut-off, network); field problems sit under their field. */}
          <div role="alert" aria-atomic="true">
            {formError ? (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </p>
            ) : null}
          </div>

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

/** Error text under a field; icon + words so it never relies on colour. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function PaymentOption(props: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
        props.checked ? "border-primary bg-primary/10" : props.invalid ? "border-destructive" : "border-border",
      )}
    >
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        onChange={props.onSelect}
        aria-describedby={props.describedBy}
        className="mt-0.5 h-4 w-4 scroll-my-24 accent-[hsl(var(--primary))]"
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{props.label}</span>
        <span className="text-xs text-muted-foreground">{props.hint}</span>
      </span>
    </label>
  );
}
