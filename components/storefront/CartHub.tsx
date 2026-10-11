"use client";

import { ShoppingBag } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { formatINR } from "@/lib/currency";

/**
 * One cart bar for the whole storefront page.
 *
 * A buyer can fill more than one cart on a page — a drop's and the everyday
 * menu's — and each is still its own order with its own checkout (different
 * endpoints, fulfilment windows and stock rules). Rather than one sticky bar
 * per section, each cart registers here and this renders a single bar fixed to
 * the bottom of the screen: one row when one cart has items, a labelled row
 * per cart ("2 separate orders") when several do.
 *
 * Carts outside a provider fall back to their own CartBar — `useCartHubEntry`
 * tells them which.
 */

export type CartHubEntry = {
  /** Stable per cart: "menu" or "drop:<dropId>". */
  key: string;
  /** "Pre-order · Saturday bakes" / "Everyday menu". */
  label: string;
  itemCount: number;
  subtotalPaise: number;
  canPay: boolean;
  onCheckout: () => void;
};

type HubApi = {
  set: (entry: CartHubEntry) => void;
  remove: (key: string) => void;
};

const HubContext = createContext<HubApi | null>(null);

/**
 * Registers a cart with the page's hub while `enabled`. Returns true when a hub
 * is present (the caller then renders no bar of its own).
 */
export function useCartHubEntry(entry: CartHubEntry & { enabled: boolean }): boolean {
  const hub = useContext(HubContext);
  const onCheckoutRef = useRef(entry.onCheckout);
  onCheckoutRef.current = entry.onCheckout;
  const { key, label, itemCount, subtotalPaise, canPay, enabled } = entry;

  useEffect(() => {
    if (!hub) return;
    if (!enabled) {
      hub.remove(key);
      return;
    }
    hub.set({ key, label, itemCount, subtotalPaise, canPay, onCheckout: () => onCheckoutRef.current() });
  }, [hub, key, label, itemCount, subtotalPaise, canPay, enabled]);

  useEffect(() => {
    if (!hub) return;
    return () => hub.remove(key);
  }, [hub, key]);

  return hub !== null;
}

function itemsLabel(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

export function CartHubProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, CartHubEntry>>({});
  const api = useMemo<HubApi>(
    () => ({
      set: (e) => setEntries((prev) => ({ ...prev, [e.key]: e })),
      remove: (key) =>
        setEntries((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }),
    }),
    [],
  );

  // Insertion order = render order on the page: drops above the menu.
  const active = Object.values(entries).filter((e) => e.itemCount > 0);

  // Reserve the bar's height at the end of the page so it never covers the footer.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) {
      setBarHeight(0);
      return;
    }
    const measure = () => setBarHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active.length]);

  const announcement =
    active.length === 0
      ? "Cart is empty"
      : active.length === 1
        ? `Cart: ${itemsLabel(active[0].itemCount)}, ${formatINR(active[0].subtotalPaise)}`
        : `${active.length} separate orders: ` +
          active.map((e) => `${e.label}, ${itemsLabel(e.itemCount)}, ${formatINR(e.subtotalPaise)}`).join("; ");

  return (
    <HubContext.Provider value={api}>
      {children}

      <div aria-hidden="true" style={{ height: barHeight }} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {active.length > 0 ? (
        <div
          ref={barRef}
          // Above the cookie banner while it shows (CookieConsentBanner publishes its height).
          className="fixed inset-x-0 bottom-(--cookie-banner-h,0px) z-30 pb-[max(env(safe-area-inset-bottom),0.75rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]"
        >
          <div className="mx-auto max-w-2xl rounded-2xl bg-awaaz-charcoal px-4 py-3 text-white shadow-lg animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
            {active.length > 1 ? (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/70">
                {active.length} separate orders
              </p>
            ) : null}
            <ul className="space-y-2">
              {active.map((e) => (
                <li key={e.key} className="flex items-center gap-3">
                  <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-sm" aria-hidden="true">
                    <span className="block truncate text-xs text-white/70">{e.label}</span>
                    <span className="font-semibold">{itemsLabel(e.itemCount)}</span>
                    <span className="mx-1.5 opacity-60">·</span>
                    <span className="font-mono font-bold tabular-nums">{formatINR(e.subtotalPaise)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={e.onCheckout}
                    disabled={!e.canPay}
                    aria-label={active.length > 1 ? `Checkout ${e.label}` : "Checkout"}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-awaaz-charcoal disabled:opacity-50"
                  >
                    Checkout
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </HubContext.Provider>
  );
}
