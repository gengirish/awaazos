import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { planFromRazorpayPlanId, verifyRazorpaySignature } from "@/lib/razorpay";
import { getClientIp, tooManyRequests, webhookRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function addDaysUtc(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type SubEntity = {
  id?: string;
  plan_id?: string;
  notes?: Record<string, string | number | undefined | null>;
};

function parseSubscriptionEntity(body: unknown): SubEntity | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const payload = b.payload;
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const sub = p.subscription;
  if (!sub || typeof sub !== "object") return null;
  const s = sub as Record<string, unknown>;
  const ent = s.entity;
  if (!ent || typeof ent !== "object") return null;
  return ent as SubEntity;
}

function maskId(id: string | undefined): string {
  if (!id) return "?";
  return id.length <= 4 ? "****" : `…${id.slice(-4)}`;
}

async function resolveVendorId(entity: SubEntity): Promise<string | null> {
  const raw = entity.notes?.vendorId ?? entity.notes?.vendor_id;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (entity.id) {
    const row = await prisma.vendorSettings.findFirst({
      where: { razorpaySubId: entity.id },
      select: { vendorId: true },
    });
    return row?.vendorId ?? null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await webhookRateLimit.check(`razorpay:${ip}`);
  if (!rl.ok) {
    return tooManyRequests(rl, "webhook-razorpay");
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature");
  if (!verifyRazorpaySignature(rawBody, sig)) {
    return NextResponse.json({}, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    console.warn("[webhooks/razorpay] invalid json");
    return NextResponse.json({ ok: true });
  }

  const b = body as Record<string, unknown>;
  const event = typeof b.event === "string" ? b.event : "";
  const eventId = typeof b.id === "string" ? b.id : "unknown";

  console.info("[webhooks/razorpay] event=%s id=%s", event, maskId(eventId));

  const entity = parseSubscriptionEntity(body);

  try {
    switch (event) {
      case "subscription.activated": {
        if (!entity?.id) break;
        const vendorId = await resolveVendorId(entity);
        if (!vendorId) {
          console.warn("[webhooks/razorpay] activated: missing vendor");
          break;
        }
        const planId = typeof entity.plan_id === "string" ? entity.plan_id : "";
        const plan = planId ? planFromRazorpayPlanId(planId) : null;
        if (!plan) {
          console.warn("[webhooks/razorpay] activated: unknown plan_id %s", maskId(planId));
          break;
        }
        const planExpiresAt = addDaysUtc(new Date(), 30);
        await prisma.$transaction([
          prisma.vendor.update({
            where: { id: vendorId },
            data: { plan, planExpiresAt },
          }),
          prisma.vendorSettings.upsert({
            where: { vendorId },
            create: { vendorId, razorpaySubId: entity.id },
            update: { razorpaySubId: entity.id },
          }),
        ]);
        break;
      }
      case "subscription.charged": {
        if (!entity?.id) break;
        const vendorId = await resolveVendorId(entity);
        if (!vendorId) break;
        const vendor = await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { planExpiresAt: true },
        });
        const base =
          vendor?.planExpiresAt && vendor.planExpiresAt > new Date()
            ? vendor.planExpiresAt
            : new Date();
        await prisma.vendor.update({
          where: { id: vendorId },
          data: { planExpiresAt: addDaysUtc(base, 30) },
        });
        break;
      }
      case "subscription.cancelled":
      case "subscription.halted": {
        if (!entity?.id) break;
        const vendorId = await resolveVendorId(entity);
        if (!vendorId) break;
        await prisma.$transaction([
          prisma.vendor.update({
            where: { id: vendorId },
            data: { plan: "FREE", planExpiresAt: null },
          }),
          prisma.vendorSettings.updateMany({
            where: { vendorId },
            data: { razorpaySubId: null },
          }),
        ]);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[webhooks/razorpay] handler error", e);
  }

  return NextResponse.json({ ok: true });
}
