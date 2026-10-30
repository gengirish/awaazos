import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, PlanGateError, requirePlan, requireVendorRole } from "@/lib/rbac";
import { encryptSecret, isSecretBoxConfigured } from "@/lib/secret-box";
import {
  CLEARED_KEY_COLUMNS,
  CLEARED_OAUTH_COLUMNS,
  hasOauthConnection,
  hasStoredRazorpayKeys,
  keySecretAad,
  RAZORPAY_KEY_ID_PATTERN,
  revokeVendorOauth,
  validateKeys,
  vendorWebhookUrl,
  webhookSecretAad,
} from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The vendor's OWN Razorpay account for storefront payments.
 *
 * OWNER only. Secrets are write-only: they go in encrypted (lib/secret-box.ts)
 * and never come back out of this API — GET returns only whether keys are set
 * and the last 4 of the (public) key id. Saving is STARTER-gated
 * (`PLAN_LIMITS.razorpayLinks`); removing is not, so a downgraded vendor can
 * still clear her keys.
 *
 * The other way in is "Connect Razorpay" (OAuth, ./razorpay/connect). A store has
 * one at a time: saving keys disconnects OAuth, connecting clears the keys, and
 * DELETE removes whichever is there (revoking our OAuth access with Razorpay).
 *
 * Request bodies here contain secrets: never log them.
 */

const putSchema = z.object({
  keyId: z.string().trim().regex(RAZORPAY_KEY_ID_PATTERN, "Key ID must start with rzp_live_ or rzp_test_"),
  keySecret: z.string().trim().min(8).max(128),
  webhookSecret: z.string().trim().min(8).max(128),
});

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

function notConfigured() {
  return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
}

function handleError(err: unknown, scope: string) {
  if (err instanceof PlanGateError) {
    return NextResponse.json(
      {
        error: err.message,
        code: "plan_upgrade_required",
        requiredPlan: err.required,
        currentPlan: err.current,
        feature: "razorpay_storefront_payments",
      },
      { status: err.status },
    );
  }
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Error name only — a stack or message could carry request fields.
  console.error(
    JSON.stringify({ event: "vendor_payments_failed", scope, error: err instanceof Error ? err.name : "unknown" }),
  );
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    const s = await prisma.vendorSettings.findUnique({
      where: { vendorId: ctx.vendor.id },
      select: {
        razorpayKeyId: true,
        razorpayKeySecretEnc: true,
        razorpayWebhookSecretEnc: true,
        razorpayAccountId: true,
        razorpayAccessTokenEnc: true,
        razorpayRefreshTokenEnc: true,
        razorpayPublicToken: true,
      },
    });
    const keysSaved = hasStoredRazorpayKeys(s);
    const oauth = hasOauthConnection(s);
    const res = NextResponse.json({
      data: {
        configured: keysSaved || oauth,
        method: oauth ? "oauth" : keysSaved ? "keys" : null,
        accountId: oauth ? s?.razorpayAccountId ?? null : null,
        keyIdLast4: keysSaved && s?.razorpayKeyId ? s.razorpayKeyId.slice(-4) : null,
        webhookUrl: vendorWebhookUrl(ctx.vendor.id),
      },
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return handleError(err, "get");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    requirePlan(ctx.vendor, "STARTER");
    if (!isSecretBoxConfigured()) return notConfigured();

    const rl = await writeRateLimit.check(`vendor-payments:${ctx.vendor.id}`);
    if (!rl.ok) return tooManyRequests(rl, "vendor-payments");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      // Issues only name the failing field; Zod does not echo the input value for these checks.
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })) },
        { status: 400 },
      );
    }
    const { keyId, keySecret, webhookSecret } = parsed.data;

    let valid: boolean;
    try {
      valid = await validateKeys({ keyId, keySecret });
    } catch {
      return NextResponse.json({ error: "razorpay_unreachable" }, { status: 502 });
    }
    if (!valid) return NextResponse.json({ error: "invalid_razorpay_keys" }, { status: 400 });

    const vendorId = ctx.vendor.id;
    await revokeVendorOauth(vendorId);
    const data = {
      ...CLEARED_OAUTH_COLUMNS,
      razorpayKeyId: keyId,
      razorpayKeySecretEnc: encryptSecret(keySecret, keySecretAad(vendorId)),
      razorpayWebhookSecretEnc: encryptSecret(webhookSecret, webhookSecretAad(vendorId)),
    };
    await prisma.vendorSettings.upsert({
      where: { vendorId },
      create: { vendorId, ...data },
      update: data,
    });

    console.info(JSON.stringify({ event: "vendor_payments_keys_saved", vendorId, mode: keyId.startsWith("rzp_live_") ? "live" : "test" }));
    const res = NextResponse.json({
      data: {
        configured: true,
        method: "keys",
        accountId: null,
        keyIdLast4: keyId.slice(-4),
        webhookUrl: vendorWebhookUrl(vendorId),
      },
    });
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return handleError(err, "put");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    await revokeVendorOauth(ctx.vendor.id);
    await prisma.vendorSettings.updateMany({
      where: { vendorId: ctx.vendor.id },
      data: { ...CLEARED_KEY_COLUMNS, ...CLEARED_OAUTH_COLUMNS },
    });
    console.info(JSON.stringify({ event: "vendor_payments_keys_removed", vendorId: ctx.vendor.id }));
    return withVendorCookie(NextResponse.json({ success: true }), ctx.setVendorCookie);
  } catch (err) {
    return handleError(err, "delete");
  }
}
