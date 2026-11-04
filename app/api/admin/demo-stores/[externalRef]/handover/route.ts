import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { createHandover } from "@/lib/demo-store";
import { demoHandoverSchema, externalRefSchema } from "@/lib/demo-store-schema";
import { sendDemoClaimEmail } from "@/lib/email";
import { readJson } from "@/lib/internal-api";
import { assertSalesOwnsDemoStore } from "@/lib/sales-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/demo-stores/{external_ref}/handover — platform ADMIN, or the
 * SALES user who built the store. A one-time claim link (7 days) for the
 * prospect's email, and emails it to them. Creates no account. A failed send
 * doesn't fail the request: `emailed: false` tells the admin to pass the link on
 * themselves.
 */
export const POST = adminRoute<{ externalRef: string }>(
  "SALES",
  "POST /api/admin/demo-stores/[ref]/handover",
  async (req, { params, actor, user }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertSalesOwnsDemoStore(user, actor, ref.data);
    const body = demoHandoverSchema.parse(await readJson(req));
    const { claim_url, expires_at, store_name } = await createHandover(ref.data, body.owner_email, actor);
    const { delivered } = await sendDemoClaimEmail({
      to: body.owner_email,
      storeName: store_name,
      claimUrl: claim_url,
      expiresAt: new Date(expires_at),
    });
    return NextResponse.json({ data: { claim_url, expires_at, emailed: delivered } }, { status: 201 });
  },
);
