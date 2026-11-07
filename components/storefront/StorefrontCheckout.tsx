"use client";

import { AlertCircle, Clock, Gift, Loader2, MapPin, Minus, Plus, ShieldCheck, ShoppingBag, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { rememberRecentOrder } from "@/components/storefront/recent-orders";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioOption } from "@/components/ui/radio-option";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatINR, sumPaise } from "@/lib/currency";
import { discountLabel, giftLineName } from "@/lib/offers";
import { orderSrcFromSearch } from "@/lib/order-channel";
import { loadCheckout } from "@/lib/razorpay-checkout";
import { orderPagePath } from "@/lib/storefront-direct-pay";
import { formatIndianMobile, normaliseIndianMobile } from "@/lib/phone";
import {
  CHECKOUT_FIELD_MESSAGES,
  checkoutErrorsFromIssues,
  checkoutFieldForErrorCode,
  firstInvalidField,
  maxOrderableQty,
  orderErrorMessage,
  parseSavedBuyer,
  parseStoredCart,
  restoreCartLines,
  sameCartLines,
  savedContactUsable,
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
 * sheet with an editable cart summary (the same stepper, so quantities can be
 * changed and lines removed without leaving the sheet), remember-me, phone
 * normalisation, idempotent submit and per-field error copy. A returning buyer
 * sees their saved details as one card with "Change", so the order is a tap.
 *
 * The server is authoritative for price, stock and every limit. Nothing here
 * sends a price — callers build the request body from ids + quantities only.
 * Buyer details live only in this component's state and the device's
 * localStorage (on by default, untick "Remember" to clear); they are never logged. The saved cart holds ids + quantities
 * only, never buyer details. A placed order is remembered on the device as its
 * token, bill number and time (recent-orders.ts) so a guest can find it again.
 */

export type FulfilmentType = "DELIVERY" | "PICKUP";
export type PaymentMethod = "UPI" | "CASH";

export type BuyerPrefill = {
  name: string | null;
  /** E.164 as stored (+91XXXXXXXXXX). */
  phone: string | null;
  address: string | null;
};

export type CheckoutLine = {
  id: string;
  name: string;
  priceInPaise: number;
  qty: number;
  /**
   * The most of this line the buyer may order (stock and per-order limit, see
   * `maxOrderableQty`). Caps the "+" in the sheet's cart summary; absent =
   * the generic line cap.
   */
  max?: number;
};

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

/**
 * "Add" button at 0, else 44×44 −/qty/+ group.
 *
 * The two states are different elements, so the button that was tapped
 * unmounts on 0 → 1 and 1 → 0. Focus is moved by hand: to "+" after the first
 * add, back to "Add" after the last one is removed — a keyboard or switch user
 * is never dropped at the top of the page.
 */
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
  const addRef = useRef<HTMLButtonElement>(null);
  const minusRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  /** Set by the tap that swaps the two states; consumed once the new one is mounted. */
  const moveFocusRef = useRef(false);

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    if (qty === 0) addRef.current?.focus();
    // "+" is disabled when one is already the most allowed.
    else (plusRef.current?.disabled ? minusRef.current : plusRef.current)?.focus();
  }, [qty]);

  if (qty === 0) {
    return (
      <button
        ref={addRef}
        type="button"
        onClick={() => {
          moveFocusRef.current = true;
          onChange(1);
        }}
        disabled={max < 1}
        className="inline-flex min-h-11 min-w-[72px] shrink-0 items-center justify-center gap-1 rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
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
        ref={minusRef}
        type="button"
        onClick={() => {
          moveFocusRef.current = qty === 1;
          onChange(qty - 1);
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`Remove one ${itemName}`}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-6 text-center font-mono text-base font-bold tabular-nums">
        <span aria-hidden="true">{qty}</span>
        <span className="sr-only">{qty} in cart</span>
      </span>
      <button
        ref={plusRef}
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40"
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
 * stack. Takes no space while the cart is empty; the live region stays
 * mounted so the first add is still announced.
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
  const summary = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  return (
    // Sits above the cookie banner while it shows (CookieConsentBanner publishes its height).
    <div className={cn("sticky bottom-(--cookie-banner-h,0px) z-10", itemCount > 0 && "pb-3 pt-3")}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {itemCount > 0 ? `Cart: ${summary}, ${formatINR(subtotalPaise)}` : "Cart is empty"}
      </p>
      {itemCount > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-awaaz-charcoal px-4 py-3 text-white shadow-lg animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
          <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm" aria-hidden="true">
            <span className="font-semibold">{summary}</span>
            <span className="mx-1.5 opacity-60">·</span>
            <span className="font-mono font-bold tabular-nums">{formatINR(subtotalPaise)}</span>
          </p>
          <button
            ref={buttonRef}
            type="button"
            onClick={onCheckout}
            disabled={!canPay}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-charcoal disabled:opacity-50"
          >
            Checkout
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Shown in place of a usable checkout when the vendor offers no payment path. */
export function NoPaymentNotice() {
  return (
    <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground">
      This store hasn&apos;t set up online payment yet — message them to order.
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
  /** Named in the "you pay the store directly" line under the form. */
  storeName?: string;
  lines: CheckoutLine[];
  /**
   * Lets the buyer change quantities (and remove lines, at 0) from the cart
   * summary inside the sheet. The caller owns the cart: it applies the change
   * and passes the new `lines` (and `discount`) back down. Absent → read-only
   * summary.
   */
  onChangeQty?: (id: string, qty: number) => void;
  /**
   * The offer this cart earns, as previewed in the browser (lib/offers.ts).
   * The server prices the order again when it is placed.
   */
  discount?: { name: string; discountPaise: number } | null;
  /** A free item the cart earns (lib/offers.ts). Shown as a ₹0 line; the server adds it. */
  gift?: { name: string; qty: number } | null;
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  /** Where to collect, as the vendor wrote it. Never invented when absent. */
  pickupNote: string | null;
  /** When to collect (drops: the fulfilment window label), if known. */
  pickupWindow?: string | null;
  payment: { upi: boolean; cod: boolean; online: boolean };
  /**
   * The store has a WhatsApp number: also offer the "Also send my order to
   * the store on WhatsApp" checkbox (off by default). Same order, same
   * endpoint — the order page then leads with a wa.me link carrying the whole
   * order (`?wa=1`).
   */
  whatsapp?: boolean;
  prefill?: BuyerPrefill | null;
  /**
   * The store's colour (`storeThemeAttribute`). The sheet is portalled to
   * <body>, outside the page's `data-theme`, so it carries its own.
   */
  theme?: string;
  /** Example text in the note field (`StoreVocabulary.orderNoteExample`). */
  notesExample?: string;
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
    storeName,
    lines,
    onChangeQty,
    discount,
    gift,
    fulfilmentTypes,
    deliveryFeePaise,
    pickupNote,
    pickupWindow,
    payment,
    whatsapp = false,
    prefill,
    theme,
    notesExample,
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
  const [remember, setRemember] = useState(true);
  /** Name and phone are already known: show them as one card with "Change". */
  const [contactFolded, setContactFolded] = useState(false);
  /** Same for the address. Set when details load, never while typing, so the field can't vanish mid-word. */
  const [addressFolded, setAddressFolded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [fulfilment, setFulfilment] = useState<FulfilmentType>(fulfilmentTypes[0] ?? "PICKUP");
  const [method, setMethod] = useState<PaymentMethod | null>(
    payment.upi ? "UPI" : payment.cod ? "CASH" : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [sendOnWhatsapp, setSendOnWhatsapp] = useState(false);
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
      const usable = savedContactUsable(saved.name, saved.phone);
      setContactFolded(usable);
      setAddressFolded(usable && saved.address.trim() !== "");
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
    if (errors.name || errors.phone) setContactFolded(false);
    if (errors.address) setAddressFolded(false);
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

  // A head start on the Razorpay window, which opens right after this sheet. A failed load is retried there.
  useEffect(() => {
    if (open && payment.online) loadCheckout().catch(() => {});
  }, [open, payment.online]);

  const subtotalPaise = sumPaise(lines.map((l) => l.priceInPaise * l.qty));
  const feePaise = fulfilment === "DELIVERY" ? deliveryFeePaise : 0;
  const discountPaise = discount?.discountPaise ?? 0;
  const totalPaise = subtotalPaise - discountPaise + feePaise;
  // One way to pay needs no choice. Two radios only when there are two.
  const onlyPayment = payment.upi && payment.cod ? null : payment.upi ? "UPI" : payment.cod ? "CASH" : null;
  const showBreakdown = discountPaise > 0 || fulfilment === "DELIVERY";
  /** What sits between the cart lines and the total, for the line under the footer total. */
  const totalNote = [
    discountPaise > 0 ? `${formatINR(discountPaise)} off` : null,
    fulfilment === "DELIVERY" ? (feePaise > 0 ? `incl. ${formatINR(feePaise)} delivery` : "free delivery") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function changeDetails() {
    setContactFolded(false);
    setAddressFolded(false);
    setFocusRequest((r) => ({ field: "name", n: (r?.n ?? 0) + 1 }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    const viaWhatsapp = whatsapp && sendOnWhatsapp;

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
        body: JSON.stringify({
          ...buildBody({
            customerName: name.trim(),
            customerPhone: normaliseIndianMobile(phone),
            fulfilmentType: fulfilment,
            deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : null,
            notes: notes.trim() || null,
            paymentMethod: method ?? "UPI",
          }),
          src: orderSrcFromSearch(window.location.search),
        }),
      });
    } catch {
      setSubmitting(false);
      setFormError("Couldn't reach the store — check your connection and try again.");
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
      const data = (json as { data?: { orderToken?: string; billNumber?: string } } | null)?.data;
      const token = data?.orderToken;
      if (remember) persistDetails();
      else writeSavedBuyerRaw(null);
      onOrdered?.();
      if (token) {
        // So the store page can point back at it; the order page records it too.
        if (data?.billNumber) rememberRecentOrder(slug, { token, billNumber: data.billNumber, createdAt: Date.now() });
        router.push(orderPagePath(slug, token, { viaWhatsapp, payNow: method === "UPI" && payment.online }));
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
    <ResponsiveDialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      {/* Header (title + close) and footer (total + Place order) stay put; only the cards scroll. */}
      <ResponsiveDialogContent
        data-theme={theme}
        className="bg-muted"
        onCloseAutoFocus={(e) => {
          const target = returnFocusRef?.current;
          if (target && target.isConnected) {
            e.preventDefault();
            target.focus();
          }
        }}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="font-display text-xl">Checkout</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <ResponsiveDialogBody className="space-y-4">
            <CheckoutCard title="Your order">
              <CartLines
                lines={lines}
                gift={lines.length > 0 ? (gift ?? null) : null}
                onChangeQty={onChangeQty}
                onAddMore={onChangeQty && !submitting ? () => onOpenChange(false) : undefined}
              />
              {/* The lines show list prices: what comes off and what delivery costs sit right under them. */}
              {showBreakdown && lines.length > 0 ? (
                <dl className="mt-1 space-y-1 border-t border-border/60 pt-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Items</dt>
                    <dd className="font-mono tabular-nums">{formatINR(subtotalPaise)}</dd>
                  </div>
                  {discount && discountPaise > 0 ? (
                    <div className="flex justify-between gap-3 font-semibold text-primary">
                      <dt className="min-w-0 break-words">{discountLabel(discount.name)}</dt>
                      <dd className="shrink-0 font-mono tabular-nums">−{formatINR(discountPaise)}</dd>
                    </div>
                  ) : null}
                  {fulfilment === "DELIVERY" ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Delivery fee</dt>
                      <dd className="font-mono tabular-nums">{feePaise > 0 ? formatINR(feePaise) : "Free"}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between pt-1 text-base font-bold">
                    <dt>Total</dt>
                    <dd className="font-mono tabular-nums">{formatINR(totalPaise)}</dd>
                  </div>
                </dl>
              ) : null}
            </CheckoutCard>

            <CheckoutCard title="Your details">
              {contactFolded ? (
                <div className="flex items-start gap-3 text-sm">
                  <Smartphone className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 py-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                      {formatIndianMobile(normaliseIndianMobile(phone))}
                    </span>
                    {fulfilment === "DELIVERY" && addressFolded ? (
                      <span className="mt-1 block whitespace-pre-line break-words text-muted-foreground">{address}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={changeDetails}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Change
                    <span className="sr-only"> your details</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
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
                      className="h-12 scroll-my-24 rounded-xl aria-invalid:border-destructive"
                    />
                    <FieldError id={ids.error("name")} message={fieldErrors.name} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={ids.phone}>Mobile number</Label>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-12 items-center rounded-xl border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
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
                        className="h-12 scroll-my-24 rounded-xl aria-invalid:border-destructive"
                      />
                    </div>
                    <FieldError id={ids.error("phone")} message={fieldErrors.phone} />
                    <p id={ids.phoneHint} className="text-xs text-muted-foreground">
                      The store uses this to reach you about this order.
                    </p>
                  </div>

                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => onRememberChange(e.target.checked)}
                      className="h-5 w-5 accent-[hsl(var(--primary))]"
                    />
                    Remember my details on this device
                  </label>
                </div>
              )}
            </CheckoutCard>

            <CheckoutCard
              title={fulfilmentTypes.length > 1 ? "Pickup or delivery" : fulfilment === "DELIVERY" ? "Delivery" : "Pickup"}
            >
              <div className="space-y-3">
                {fulfilmentTypes.length > 1 ? (
                  <fieldset>
                    <legend className="sr-only">Delivery or pickup</legend>
                    {/* A segmented control made of native radios: arrow keys and the checked state come free. */}
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                      {fulfilmentTypes.map((t) => (
                        <RadioOption
                          key={t}
                          name={`${idPrefix}-fulfilment`}
                          value={t}
                          checked={fulfilment === t}
                          onChange={() => {
                            setFulfilment(t);
                            revalidate("address", { fulfilment: t });
                          }}
                          size="compact"
                          className={cn(
                            "rounded-lg border-transparent",
                            fulfilment === t ? "bg-background shadow-sm" : "bg-transparent text-muted-foreground",
                          )}
                          inputClassName="sr-only"
                          label={
                            t === "DELIVERY"
                              ? deliveryFeePaise > 0
                                ? `Delivery (+${formatINR(deliveryFeePaise)})`
                                : "Delivery"
                              : "Pickup"
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {fulfilment === "DELIVERY" && addressFolded ? null : fulfilment === "DELIVERY" ? (
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
                      className="flex w-full scroll-my-24 rounded-xl border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:border-destructive md:text-sm"
                    />
                    <FieldError id={ids.error("address")} message={fieldErrors.address} />
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {pickupNote ? (
                        <span>
                          <span className="font-semibold">Pickup: </span>
                          {pickupNote}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{PICKUP_FALLBACK}</span>
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

                {notesOpen ? (
                  <div className="space-y-2">
                    <Label htmlFor={`${idPrefix}-notes`}>Note for the store (optional)</Label>
                    <Input
                      id={`${idPrefix}-notes`}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={280}
                      placeholder={notesExample}
                      autoFocus
                      className="h-12 rounded-xl"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotesOpen(true)}
                    className="-mx-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add a note for the store
                  </button>
                )}
              </div>
            </CheckoutCard>

            <section className="space-y-3 rounded-2xl border border-border bg-card p-4 text-card-foreground">
              <fieldset
                id={ids.payment}
                aria-invalid={fieldErrors.payment ? true : undefined}
                aria-describedby={describedBy("payment")}
                className="space-y-2"
              >
                <legend className="mb-2 text-base font-semibold">Payment</legend>
                {onlyPayment ? (
                  <p className="text-sm text-muted-foreground">
                    {onlyPayment === "UPI"
                      ? payment.online
                        ? "Pay online by UPI, card or netbanking, secured by Razorpay."
                        : "Pay by UPI on the next screen, with any UPI app."
                      : fulfilment === "PICKUP"
                        ? "Pay when you collect."
                        : "Pay on delivery, by cash or UPI at the door."}
                  </p>
                ) : null}
                <div className={cn("grid gap-2 sm:grid-cols-2", onlyPayment && "hidden")}>
                  {payment.upi ? (
                    <PaymentOption
                      name={`${idPrefix}-payment`}
                      checked={method === "UPI"}
                      onSelect={() => {
                        setMethod("UPI");
                        revalidate("payment", { method: "UPI" });
                      }}
                      label={payment.online ? "Pay online" : "Pay now by UPI"}
                      hint={payment.online ? "UPI, cards or netbanking · secured by Razorpay" : "Any UPI app, on the next screen"}
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

              {whatsapp ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={sendOnWhatsapp}
                    onChange={(e) => setSendOnWhatsapp(e.target.checked)}
                    disabled={submitting}
                    className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  Also send my order to the store on WhatsApp
                </label>
              ) : null}
            </section>

            {/* True on every path: UPI goes to the store's own UPI ID, "Pay online" to its own Razorpay account. */}
            <p className="flex items-start gap-2.5 px-1 text-sm leading-snug text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>You pay {storeName || "the store"} directly. AwaazOS never holds your money.</span>
            </p>
          </ResponsiveDialogBody>

          {/* Order-level problems only (stock, cut-off, network); field problems sit under their field.
              Outside the scrolling body, so it is in view whatever the scroll position. */}
          <div role="alert" aria-atomic="true" className={cn("shrink-0 px-4 md:px-6", formError && "pb-3 pt-1")}>
            {formError ? (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </p>
            ) : null}
          </div>

          <ResponsiveDialogFooter className="flex-col gap-2 md:flex-col md:border-t md:pb-4 md:pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="flex flex-col items-end">
                <span className="font-mono text-xl font-bold tabular-nums" aria-live="polite">
                  {formatINR(totalPaise)}
                </span>
                {/* The footer stays put while the breakdown scrolls away: say what changed the total. */}
                {totalNote && lines.length > 0 ? <span className="text-xs text-muted-foreground">{totalNote}</span> : null}
              </span>
            </div>
            <button
              type="submit"
              disabled={submitting || lines.length === 0}
              aria-busy={submitting}
              className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-base font-bold text-primary-foreground shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              {submitting
                ? "Placing order…"
                : method === "UPI" && payment.online
                  ? `Pay ${formatINR(totalPaise)}`
                  : `${method === "UPI" ? "Place order & pay" : "Place order"} · ${formatINR(totalPaise)}`}
            </button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One white card of the checkout sheet, under its own heading. */
function CheckoutCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const EMPTY_CART_COPY = "Your cart is empty. Close this to add items.";

/**
 * The cart summary at the top of the sheet. With `onChangeQty`, each line
 * carries the same −/qty/+ stepper as the store page, so the buyer corrects an
 * order where they are about to pay for it. A line leaves the list at 0; focus
 * then moves to the neighbouring line's stepper (or the empty-cart message),
 * never out of the sheet. Prices shown are the item's list price; the offer
 * row below the form shows what comes off.
 */
function CartLines({
  lines,
  gift,
  onChangeQty,
  onAddMore,
}: {
  lines: CheckoutLine[];
  gift: { name: string; qty: number } | null;
  onChangeQty?: (id: string, qty: number) => void;
  /** Closes the sheet so the buyer can pick more from the store page. */
  onAddMore?: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  /** Index of the line just removed by its stepper; the next render focuses its neighbour. */
  const removedAtRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const removedAt = removedAtRef.current;
    if (removedAt === null) return;
    removedAtRef.current = null;
    if (lines.length === 0) {
      emptyRef.current?.focus();
      return;
    }
    const li = listRef.current?.children[Math.min(removedAt, lines.length - 1)];
    li?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [lines]);

  if (lines.length === 0) {
    return (
      <p
        ref={emptyRef}
        tabIndex={-1}
        role="status"
        className="rounded-xl border border-dashed border-border bg-muted/50 px-3 py-3 text-sm text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      >
        {EMPTY_CART_COPY}
      </p>
    );
  }

  if (!onChangeQty) {
    return (
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {l.qty} × {l.name}
            </span>
            <span className="font-mono tabular-nums">{formatINR(l.priceInPaise * l.qty)}</span>
          </li>
        ))}
        {gift ? (
          <li className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {gift.qty} × {giftLineName(gift.name)}
            </span>
            <span className="font-semibold">Free</span>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div className="-mt-2">
      <ul ref={listRef} aria-label="Items in your cart" className="divide-y divide-border/60">
        {lines.map((l, index) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <span className="truncate font-semibold">{l.name}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                <span className="font-bold text-foreground">{formatINR(l.priceInPaise * l.qty)}</span>
                {l.qty > 1 ? ` · ${formatINR(l.priceInPaise)} each` : null}
              </span>
            </span>
            <QtyStepper
              itemName={l.name}
              qty={l.qty}
              max={l.max ?? maxOrderableQty(null, null)}
              onChange={(q) => {
                if (q <= 0) removedAtRef.current = index;
                onChangeQty(l.id, q);
              }}
            />
          </li>
        ))}
      </ul>
      {gift ? (
        <p className="flex items-center gap-3 border-t border-border/60 py-2 text-sm">
          <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {gift.qty > 1 ? `${gift.qty} × ` : ""}
            {giftLineName(gift.name)}
          </span>
          <span className="font-semibold">Free</span>
        </p>
      ) : null}
      {onAddMore ? (
        <button
          type="button"
          onClick={onAddMore}
          className="-mx-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add more items
        </button>
      ) : null}
    </div>
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
    <RadioOption
      name={props.name}
      checked={props.checked}
      onChange={props.onSelect}
      aria-describedby={props.describedBy}
      inputClassName="scroll-my-24"
      invalid={props.invalid}
      label={props.label}
      hint={props.hint}
    />
  );
}
