import { NextResponse } from "next/server";

import { bumpOrderSignal } from "@/lib/drops-signal";
import { notifyVendorInBackground, riderDeliveredPayload } from "@/lib/push";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import { markDeliveredByRider } from "@/lib/rider-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const riderRateLimit = makeLimiter({ name: "rider-delivered", windowMs: 60_000, max: 20 });

/**
 * POST /api/d/[token] — public: the rider's "Delivered" tap on /d/<token>
 * (lib/rider-delivery.ts). The 192-bit rider token is the whole credential.
 * 404 unknown token, 409 already delivered or cancelled. The seller's phones
 * hear about it (push, no buyer details) and the board refetches.
 */
export async function POST(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  try {
    const rl = await riderRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "rider-delivered");

    const r = await markDeliveredByRider(token);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.error === "not_found" ? 404 : 409 });
    }
    void bumpOrderSignal(r.vendorId);
    notifyVendorInBackground(r.vendorId, riderDeliveredPayload({ billNumber: r.billNumber, dropId: r.dropId }));
    return NextResponse.json({ data: { state: r.view.state } });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "rider_delivered_failed",
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
