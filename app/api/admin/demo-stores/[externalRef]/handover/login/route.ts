import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { rememberContactEmail } from "@/lib/demo-pipeline-server";
import { handOverWithLogin } from "@/lib/demo-store";
import { demoLoginHandoverSchema, externalRefSchema } from "@/lib/demo-store-schema";
import { readJson } from "@/lib/internal-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/demo-stores/{external_ref}/handover/login — platform ADMIN only
 * (not SALES: an intern never knows a seller's password). Hands the store over at
 * once with a login the admin sets: a new account for an email with none yet
 * (409 email_in_use otherwise: send a claim link), the same transfer as a claim
 * (lib/demo-store.ts). Sends nothing; the admin passes the login on. The password
 * is never echoed, logged or returned, and a bad body gets no Zod issues back.
 */
export const POST = adminRoute<{ externalRef: string }>(
  "ADMIN",
  "POST /api/admin/demo-stores/[ref]/handover/login",
  async (req, { params, actor }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = demoLoginHandoverSchema.safeParse(await readJson(req));
    if (!body.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const { slug, email } = await handOverWithLogin(
      ref.data,
      {
        name: body.data.owner_name,
        email: body.data.owner_email,
        password: body.data.password,
        sampleOrders: body.data.sample_orders,
      },
      actor,
    );
    await rememberContactEmail(ref.data, email);
    return NextResponse.json({ data: { slug, email } }, { status: 201 });
  },
);
