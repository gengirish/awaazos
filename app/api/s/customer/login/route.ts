import { NextResponse } from "next/server";
import { z } from "zod";

import { createLoginToken, customerLinkBase, emailRateKey, safeReturnTo } from "@/lib/customer-auth";
import { sendCustomerLoginEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getClientIp, makeLimiter, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/s/customer/login — request a storefront sign-in link.
 *
 * Public. Responds `{ success: true }` whether or not the email is already a
 * Customer (no account enumeration). Rate limited per IP and per email (the
 * email bucket key is a hash, so the limiter's own logs never carry it).
 *
 * The kitchen is derived from `returnTo` (/s/<slug>/…) and held to the same
 * publish gate as the storefront page. Unknown / unpublished kitchen → the
 * same 200, nothing created, nothing sent.
 *
 * PII: the email is never logged. The link and token are never logged.
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  returnTo: z.string().max(512),
});

const ipLimit = makeLimiter({ name: "customer-login-ip", windowMs: 15 * 60_000, max: 10 });
const emailLimit = makeLimiter({ name: "customer-login-email", windowMs: 15 * 60_000, max: 3 });

const OK = { success: true } as const;

function slugFromReturnTo(path: string): string | null {
  const m = /^\/s\/([a-z0-9-]{1,80})(?:[/?#]|$)/i.exec(path);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  try {
    const ipRl = await ipLimit.check(getClientIp(req));
    if (!ipRl.ok) return tooManyRequests(ipRl, "customer-login");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const returnTo = safeReturnTo(parsed.data.returnTo);
    if (!returnTo) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Per-email limit applies identically to known and unknown emails, so a
    // 429 here reveals nothing about account existence.
    const emailRl = await emailLimit.check(emailRateKey(parsed.data.email));
    if (!emailRl.ok) return tooManyRequests(emailRl, "customer-login");

    const slug = slugFromReturnTo(returnTo);
    const vendor = slug
      ? await prisma.vendor.findFirst({
          where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
          select: { id: true, name: true },
        })
      : null;
    if (!vendor) return NextResponse.json(OK);

    const { rawToken, expiresAt } = await createLoginToken(parsed.data.email, returnTo);
    const url = `${customerLinkBase()}/api/s/customer/verify?token=${encodeURIComponent(rawToken)}`;

    if (
      process.env.NODE_ENV !== "production" &&
      (!process.env.AGENTMAIL_API_KEY || !process.env.AGENTMAIL_INBOX_ID)
    ) {
      // Deliberately no link, token or email here.
      console.info("[customer-login] email not configured (AGENTMAIL_*); sign-in link was not sent");
    }

    await sendCustomerLoginEmail({ to: parsed.data.email, url, kitchenName: vendor.name, expiresAt });
    return NextResponse.json(OK);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "customer_login_failed",
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    // Same body as success: a 500 on "new email" vs 200 on "known email"
    // would be an enumeration oracle.
    return NextResponse.json(OK);
  }
}
