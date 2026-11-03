import { NextResponse } from "next/server";

import { bumpOrderSignal } from "@/lib/drops-signal";
import { orderFeedbackSchema } from "@/lib/order-feedback-schema";
import { recordOrderFeedback } from "@/lib/order-feedback-server";
import { notifyVendorInBackground, orderRatedPayload } from "@/lib/push";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const feedbackRateLimit = makeLimiter({ name: "storefront-feedback", windowMs: 60_000, max: 10 });

/**
 * POST /api/s/[slug]/orders/[token]/feedback — the buyer's rating of a
 * handed-over order (lib/order-feedback.ts). Public, keyed on the order token
 * plus the storefront gate. The comment is free text from a buyer: never logged,
 * never in the push. 404 no such order, 409 not handed over or already rated.
 */
export async function POST(req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
  try {
    const rl = await feedbackRateLimit.check(getClientIp(req));
    if (!rl.ok) return tooManyRequests(rl, "storefront-feedback");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = orderFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const r = await recordOrderFeedback({
      slug: params.slug,
      orderToken: params.token,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.error === "not_found" ? 404 : 409 });
    }
    void bumpOrderSignal(r.vendorId);
    notifyVendorInBackground(r.vendorId, orderRatedPayload({ billNumber: r.billNumber, rating: parsed.data.rating }));
    return NextResponse.json({ data: { rating: parsed.data.rating } }, { status: 201 });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "storefront_feedback_failed",
        slug: params.slug,
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
