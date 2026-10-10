import { NextResponse } from "next/server";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { beginIdempotency, getIdempotencyKey } from "@/lib/idempotency";
import { placeMenuOrder } from "@/lib/menu-orders";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import { storefrontMenuOrderSchema } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public "Order from menu" placement — the everyday-menu twin of
 * app/api/s/[slug]/orders (drops). Same narrow public rules:
 *   - the vendor must exist, be active and have opted in (publishStorefront),
 *     otherwise 404 — never 403. Whether menu ordering itself is on
 *     (acceptMenuOrders) is a business rule: placeMenuOrder answers
 *     409 menu_orders_disabled, the storefront is already public;
 *   - the vendor `select` is a hand-written allowlist: id + plan + only the
 *     settings placeMenuOrder needs. No contact PII is loaded;
 *   - prices are never taken from the client — placeMenuOrder re-reads every
 *     line from available MenuItem rows of this vendor.
 *
 * PII: the body carries buyer name, phone, address and notes. None of them may
 * appear in a log line — log vendorId and error codes only.
 *
 * Optional buyer session (lib/customer-auth.ts) links the order and back-fills
 * the customer's EMPTY profile fields, exactly as the drop route does.
 */

const menuOrderRateLimit = makeLimiter({
  name: "storefront-menu-order",
  windowMs: 60_000,
  max: 10,
});

/**
 * Fill only the customer's empty name / phone / savedAddress from a placed
 * order. Conditional `updateMany` per field (`field: null`), so a concurrent
 * profile edit is never clobbered. Best-effort: the order already committed.
 */
async function backfillCustomerProfile(
  customer: { id: string; name: string | null; phone: string | null; savedAddress: string | null },
  from: { name: string; phone: string; address: string | null },
): Promise<void> {
  try {
    const writes = [];
    if (!customer.name && from.name) {
      writes.push(
        prisma.customer.updateMany({ where: { id: customer.id, name: null }, data: { name: from.name } }),
      );
    }
    if (!customer.phone && from.phone) {
      writes.push(
        prisma.customer.updateMany({ where: { id: customer.id, phone: null }, data: { phone: from.phone } }),
      );
    }
    if (!customer.savedAddress && from.address) {
      writes.push(
        prisma.customer.updateMany({
          where: { id: customer.id, savedAddress: null },
          data: { savedAddress: from.address },
        }),
      );
    }
    if (writes.length) await Promise.all(writes);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_customer_backfill_failed",
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
  }
}

export async function POST(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const rl = await menuOrderRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-menu-order");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = storefrontMenuOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const input = parsed.data;

    const vendor = await prisma.vendor.findFirst({
      where: {
        slug: params.slug,
        isActive: true,
        settings: { is: { publishStorefront: true } },
      },
      select: {
        id: true,
        plan: true,
        planExpiresAt: true,
        trialEndsAt: true,
        settings: {
          select: {
            acceptMenuOrders: true,
            acceptPayOnDelivery: true,
            menuFulfilmentMode: true,
            menuDeliveryFeePaise: true,
          },
        },
      },
    });
    if (!vendor?.settings) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Signed-in buyer, if any. A lookup failure degrades to guest checkout.
    const customer = await getCurrentCustomer();

    const idemKey = getIdempotencyKey(req);
    const idem = idemKey
      ? await beginIdempotency({
          scope: "storefront-menu-order",
          vendorId: vendor.id,
          idempotencyKey: idemKey,
        })
      : null;
    if (idem?.kind === "replay") {
      return NextResponse.json(idem.record.body, { status: idem.record.status });
    }
    if (idem?.kind === "in_flight") {
      return NextResponse.json({ error: "in_progress" }, { status: 409 });
    }

    const result = await placeMenuOrder({
      vendor: {
        id: vendor.id,
        plan: vendor.plan,
        planExpiresAt: vendor.planExpiresAt,
        trialEndsAt: vendor.trialEndsAt,
      },
      settings: vendor.settings,
      items: input.items,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      fulfilmentType: input.fulfilmentType,
      deliveryAddress: input.deliveryAddress ?? null,
      notes: input.notes ?? null,
      paymentMethod: input.paymentMethod,
      customerId: customer?.id ?? null,
    });

    if (result.ok && customer) {
      await backfillCustomerProfile(customer, {
        name: input.customerName,
        phone: input.customerPhone,
        address: input.fulfilmentType === "DELIVERY" ? (input.deliveryAddress ?? null) : null,
      });
    }

    let status: number;
    let responseBody: Record<string, unknown>;
    if (result.ok) {
      status = 201;
      responseBody = {
        data: {
          orderToken: result.order.orderToken,
          billNumber: result.order.billNumber,
          totalPaise: result.order.totalPaise,
        },
      };
    } else {
      // Business rejection. monthly_txn_cap_reached is deliberately a plain 409
      // with no plan details — the buyer must not learn the vendor's plan.
      const { code, ...details } = result.error;
      status = 409;
      responseBody = { error: code, ...details };
      console.info(
        JSON.stringify({
          event: "storefront_menu_order_rejected",
          vendorId: vendor.id,
          code,
        }),
      );
    }

    if (idem?.kind === "fresh") await idem.commit({ status, body: responseBody });
    return NextResponse.json(responseBody, { status });
  } catch (err) {
    // Prisma error messages can echo query arguments (buyer name, phone,
    // address), so log only the error class and Prisma code — never `.message`.
    console.error(
      JSON.stringify({
        event: "storefront_menu_order_failed",
        slug: params.slug,
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
