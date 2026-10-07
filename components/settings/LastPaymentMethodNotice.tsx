"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { LAST_PAYMENT_METHOD_ERROR, type PaymentGuardBlocker } from "@/lib/payment-guard";

export const LAST_PAYMENT_METHOD_MESSAGE =
  "Customers can order online right now (Order from menu / an open drop), so keep at least one way to pay. Turn off Order from menu in Settings → Online orders or close the drop first.";

const LINKS: Record<PaymentGuardBlocker, { href: string; text: string }> = {
  menu_orders: { href: "/settings/orders", text: "Go to Online orders" },
  open_drop: { href: "/drops", text: "Go to Drops" },
};

/**
 * Reads a PATCH /api/vendor error response: the blockers when the server refused
 * to remove the last payment method (409 last_payment_method), else null.
 */
export function lastPaymentMethodBlockersFrom(status: number, body: unknown): PaymentGuardBlocker[] | null {
  if (status !== 409 || !body || typeof body !== "object") return null;
  const b = body as { error?: unknown; blockers?: unknown };
  if (b.error !== LAST_PAYMENT_METHOD_ERROR) return null;
  const list: unknown[] = Array.isArray(b.blockers) ? b.blockers : [];
  return list.filter((x): x is PaymentGuardBlocker => x === "menu_orders" || x === "open_drop");
}

/** The server's refusal, shown inline under a payment control (e.g. from a stale tab). */
export function LastPaymentMethodNotice({ id, blockers }: { id?: string; blockers: PaymentGuardBlocker[] }) {
  // No blockers listed: show both ways out.
  const shown: PaymentGuardBlocker[] = blockers.length ? blockers : ["menu_orders", "open_drop"];
  return (
    <div
      id={id}
      role="alert"
      className="flex gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p>{LAST_PAYMENT_METHOD_MESSAGE}</p>
        <div className="flex flex-wrap gap-x-4">
          {shown.map((b) => (
            <Link
              key={b}
              href={LINKS[b].href}
              className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
            >
              {LINKS[b].text}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
