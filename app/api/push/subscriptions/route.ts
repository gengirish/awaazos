import { NextRequest, NextResponse } from "next/server";

import { isPushConfigured } from "@/lib/push";
import {
  MAX_DEVICES_PER_USER,
  countVendorPushDevices,
  hashEndpoint,
  invalidInput,
  pushErrorResponse,
  pushNotConfigured,
  subscribeSchema,
  withVendorCookie,
} from "@/lib/push-devices";
import { prisma } from "@/lib/prisma";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Web Push device opt-in for new-order alerts.
 *
 * Any staff member (CASHIER+) manages only THEIR OWN devices for the active
 * vendor. Endpoints and keys are write-only: never returned, never logged.
 */

/** GET — the current user's devices for the active vendor. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const [rows, vendorDeviceCount] = await Promise.all([
      prisma.pushSubscription.findMany({
        where: { vendorId: ctx.vendor.id, userId: ctx.user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, label: true, createdAt: true, lastSuccessAt: true, endpoint: true },
      }),
      countVendorPushDevices(ctx.vendor.id),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      endpointHash: hashEndpoint(r.endpoint),
    }));
    return withVendorCookie(
      NextResponse.json({ data, meta: { configured: isPushConfigured(), vendorDeviceCount } }),
      ctx.setVendorCookie,
    );
  } catch (err) {
    return pushErrorResponse(err, "subscriptions_get");
  }
}

/**
 * POST — register this browser. Upsert by endpoint: a phone that switched
 * account or vendor is reassigned to the current user + active vendor.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    if (!isPushConfigured()) return pushNotConfigured();

    const rl = await writeRateLimit.check(`push-sub:${ctx.user.id}`);
    if (!rl.ok) return tooManyRequests(rl, "push-subscriptions");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = subscribeSchema.safeParse(raw);
    if (!parsed.success) return invalidInput(parsed.error);
    const { endpoint, keys, label } = parsed.data;

    const vendorId = ctx.vendor.id;
    const userId = ctx.user.id;

    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true, vendorId: true },
    });
    const alreadyMine = existing?.userId === userId && existing.vendorId === vendorId;
    if (!alreadyMine) {
      const count = await prisma.pushSubscription.count({ where: { vendorId, userId } });
      if (count >= MAX_DEVICES_PER_USER) {
        return NextResponse.json({ error: "too_many_devices", max: MAX_DEVICES_PER_USER }, { status: 409 });
      }
    }

    const data = { vendorId, userId, p256dh: keys.p256dh, auth: keys.auth, label, failureCount: 0 };
    const row = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...data },
      update: data,
      select: { id: true },
    });

    console.info(
      JSON.stringify({
        event: "push_subscribed",
        vendorId,
        outcome: !existing ? "created" : alreadyMine ? "refreshed" : "reassigned",
      }),
    );
    return withVendorCookie(NextResponse.json({ data: { id: row.id } }, { status: 201 }), ctx.setVendorCookie);
  } catch (err) {
    return pushErrorResponse(err, "subscriptions_post");
  }
}

/**
 * DELETE ?endpoint=<url-encoded> — unsubscribe this browser. Always
 * `{ success: true }`: whether the endpoint existed (or was someone else's)
 * is not revealed.
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const endpoint = req.nextUrl.searchParams.get("endpoint");
    if (!endpoint || endpoint.length > 2048) {
      return NextResponse.json({ error: "Invalid input", issues: [{ path: ["endpoint"], message: "Required" }] }, { status: 400 });
    }

    const rl = await writeRateLimit.check(`push-sub:${ctx.user.id}`);
    if (!rl.ok) return tooManyRequests(rl, "push-subscriptions");

    const { count } = await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: ctx.user.id, vendorId: ctx.vendor.id },
    });
    console.info(JSON.stringify({ event: "push_unsubscribed", vendorId: ctx.vendor.id, removed: count }));
    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return pushErrorResponse(err, "subscriptions_delete");
  }
}
