import { NextResponse } from "next/server";

import { bumpOrderSignal } from "@/lib/drops-signal";
import { buyerReceivedPayload, notifyVendorInBackground } from "@/lib/push";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import { recordBuyerReceived } from "@/lib/rider-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const receivedRateLimit = makeLimiter({ name: "storefront-received", windowMs: 60_000, max: 10 });

/**
 * POST /api/s/[slug]/orders/[token]/received — the buyer's "I've received my
 * order" on a delivery (lib/rider-delivery.ts). Public, keyed on the order
 * token plus the storefront gate. A paid order is marked delivered; an unpaid
 * one only records the tap — the seller still confirms the cash.
 * 404 no such order, 409 not a live delivery or already recorded.
 */
export async function POST(req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
  try {
    const rl = await receivedRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-received");

    const r = await recordBuyerReceived({ slug: params.slug, orderToken: params.token });
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.error === "not_found" ? 404 : 409 });
    }
    void bumpOrderSignal(r.vendorId);
    notifyVendorInBackground(
      r.vendorId,
      buyerReceivedPayload({ billNumber: r.billNumber, dropId: r.dropId, delivered: r.delivered }),
    );
    return NextResponse.json({ data: { delivered: r.delivered } });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_received_failed",
        slug: params.slug,
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
