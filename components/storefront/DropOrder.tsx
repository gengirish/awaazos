"use client";

import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/currency";
import { maxOrderableQty, orderErrorMessage, stockLabel, type OrderApiError } from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

/**
 * Cart + checkout for one Drop on the public storefront.
 *
 * The server is authoritative for everything that matters (price, stock,
 * per-order limits, cut-off): this component only mirrors those limits so the
 * buyer rarely hits a rejection, and maps the API's error codes to plain copy
 * when they do. No price ever leaves the browser — only dropItemId + qty.
 */

export type DropOrderItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  priceInPaise: number;
  /** null = unlimited */
  remaining: number | null;
  perOrderLimit: number | null;
};

type FulfilmentType = "DELIVERY" | "PICKUP";
type PaymentMethod = "UPI" | "CASH";

export type DropOrderProps = {
  slug: string;
  dropId: string;
  dropTitle: string;
  items: DropOrderItem[];
  /** false → read-only preview (scheduled or closed drop) */
  orderable: boolean;
  fulfilmentTypes: FulfilmentType[];
  deliveryFeePaise: number;
  pickupNote: string | null;
  payment: { upi: boolean; cod: boolean };
  /**
   * Signed-in buyer's own saved details (lib/customer-auth.ts). Non-empty
   * fields win over the device's "remember me" values; absent for guests.
   */
  prefill?: BuyerPrefill | null;
};

export type BuyerPrefill = {
  name: string | null;
  /** E.164 as stored (+91XXXXXXXXXX). */
  phone: string | null;
  address: string | null;
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

export function DropOrder(props: DropOrderProps) {
  const {
    slug,
    dropId,
    dropTitle,
    items,
    orderable,
    fulfilmentTypes,
    deliveryFeePaise,
    pickupNote,
    payment,
    prefill,
  } = props;
  const router = useRouter();

  const [cart, setCart] = useState<Record<string, number>>({});
  // Stock learned from a sold_out rejection, until the refreshed props land.
  const [remainingOverride, setRemainingOverride] = useState<Record<string, number>>({});
  useEffect(() => setRemainingOverride({}), [items]);

  const [open, setOpen] = useState(false);
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

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function remainingFor(item: DropOrderItem): number | null {
    const o = remainingOverride[item.id];
    if (o === undefined) return item.remaining;
    return item.remaining === null ? o : Math.min(o, item.remaining);
  }

  function setQty(itemId: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  }

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(id), qty }))
    .filter((l): l is { item: DropOrderItem; qty: number } => !!l.item && l.qty > 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotalPaise = sumPaise(lines.map((l) => l.item.priceInPaise * l.qty));
  const feePaise = fulfilment === "DELIVERY" ? deliveryFeePaise : 0;
  const totalPaise = subtotalPaise + feePaise;
  const canPay = payment.upi || payment.cod;

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
      res = await fetch(`/api/s/${encodeURIComponent(slug)}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKeyRef.current,
        },
        body: JSON.stringify({
          dropId,
          items: lines.map((l) => ({ dropItemId: l.item.id, qty: l.qty })),
          customerName: name.trim(),
          customerPhone: normalisePhone(phone),
          fulfilmentType: fulfilment,
          deliveryAddress: fulfilment === "DELIVERY" ? address.trim() : null,
          notes: notes.trim() || null,
          paymentMethod: method,
        }),
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
    const item = err.dropItemId ? byId.get(err.dropItemId) : undefined;
    setError(orderErrorMessage(err, item?.name));

    if (err.error === "sold_out" && err.dropItemId) {
      const left = Math.max(0, err.remaining ?? 0);
      const id = err.dropItemId;
      setRemainingOverride((o) => ({ ...o, [id]: left }));
      setCart((c) => {
        const next = { ...c };
        if (left <= 0) delete next[id];
        else if ((next[id] ?? 0) > left) next[id] = left;
        return next;
      });
      router.refresh();
    } else if (err.error === "per_order_limit" && err.dropItemId && err.limit) {
      const id = err.dropItemId;
      const limit = err.limit;
      setCart((c) => ({ ...c, [id]: Math.min(c[id] ?? 0, limit) }));
    } else if (
      err.error === "drop_not_open" ||
      err.error === "drop_not_found" ||
      err.error === "item_not_found"
    ) {
      router.refresh();
    }
  }

  return (
    <div>
      <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
        {items.map((item) => {
          const remaining = remainingFor(item);
          const max = maxOrderableQty(remaining, item.perOrderLimit);
          const qty = cart[item.id] ?? 0;
          const soldOut = remaining !== null && remaining <= 0;
          const badge = stockLabel(remaining);
          return (
            <li key={item.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  className={cn(
                    "h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-border/60",
                    soldOut && "opacity-50",
                  )}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl",
                    soldOut && "opacity-50",
                  )}
                >
                  {item.emoji}
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-foreground">{item.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {formatINRCompact(item.priceInPaise)}
                  </span>
                  {badge ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                        soldOut ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                  {item.perOrderLimit !== null && !soldOut ? (
                    <span className="text-xs text-muted-foreground">Max {item.perOrderLimit} per order</span>
                  ) : null}
                </span>
              </span>

              {orderable && !soldOut ? (
                qty === 0 ? (
                  <button
                    type="button"
                    onClick={() => setQty(item.id, 1)}
                    disabled={max < 1}
                    className="inline-flex min-h-11 min-w-[72px] items-center justify-center gap-1 rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
                    aria-label={`Add ${item.name}`}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </button>
                ) : (
                  <div
                    className="flex shrink-0 items-center gap-2"
                    role="group"
                    aria-label={`${item.name} quantity`}
                  >
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty - 1)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                      aria-label={`Remove one ${item.name}`}
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span
                      className="w-6 text-center font-mono text-base font-bold tabular-nums"
                      aria-hidden="true"
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty(item.id, Math.min(max, qty + 1))}
                      disabled={qty >= max}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40"
                      aria-label={qty >= max ? `${item.name}: maximum reached` : `Add one more ${item.name}`}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {orderable && !canPay ? (
        <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          This kitchen hasn&apos;t set up online payment yet — message them to order.
        </p>
      ) : null}

      {orderable ? (
        /* Sticky within this drop's section only, so two open drops never stack bars. */
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
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
              disabled={itemCount === 0 || !canPay}
              tabIndex={itemCount === 0 ? -1 : 0}
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-charcoal disabled:opacity-50"
            >
              Checkout
            </button>
          </div>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[92vh] max-w-2xl overflow-y-auto rounded-t-2xl px-4 pb-6 sm:px-6"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-xl">Checkout</SheetTitle>
            <SheetDescription>{dropTitle}</SheetDescription>
          </SheetHeader>

          <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
            <ul className="space-y-1 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              {lines.map((l) => (
                <li key={l.item.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {l.qty} × {l.item.name}
                  </span>
                  <span className="font-mono tabular-nums">{formatINR(l.item.priceInPaise * l.qty)}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <Label htmlFor={`${dropId}-name`}>Your name</Label>
              <Input
                id={`${dropId}-name`}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${dropId}-phone`}>Mobile number</Label>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-11 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
                  aria-hidden="true"
                >
                  +91
                </span>
                <Input
                  id={`${dropId}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={16}
                  required
                  aria-describedby={`${dropId}-phone-hint`}
                  className="h-11"
                />
              </div>
              <p id={`${dropId}-phone-hint`} className="text-xs text-muted-foreground">
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
                        name={`${dropId}-fulfilment`}
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
                <Label htmlFor={`${dropId}-address`}>Delivery address</Label>
                <textarea
                  id={`${dropId}-address`}
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
              <Label htmlFor={`${dropId}-notes`}>Notes for the kitchen (optional)</Label>
              <Input
                id={`${dropId}-notes`}
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
                    name={`${dropId}-payment`}
                    checked={method === "UPI"}
                    onSelect={() => setMethod("UPI")}
                    label="Pay now by UPI"
                    hint="Any UPI app — you'll see a QR next"
                  />
                ) : null}
                {payment.cod ? (
                  <PaymentOption
                    name={`${dropId}-payment`}
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
    </div>
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
