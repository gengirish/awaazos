"use client";

import Link from "next/link";

import { Notice } from "@/components/ui/notice";
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
    <Notice id={id} role="alert" icon>
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
    </Notice>
  );
}
