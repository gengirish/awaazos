import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { createHandover } from "@/lib/demo-store";
import { demoHandoverSchema, externalRefSchema } from "@/lib/demo-store-schema";
import { readJson } from "@/lib/internal-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/demo-stores/{external_ref}/handover — platform ADMIN. A
 * one-time claim link (7 days) for the prospect's email; sends nothing and
 * creates no account. The admin passes the link on themselves.
 */
export const POST = adminRoute<{ externalRef: string }>(
  "ADMIN",
  "POST /api/admin/demo-stores/[ref]/handover",
  async (req, { params, actor }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = demoHandoverSchema.parse(await readJson(req));
    const data = await createHandover(ref.data, body.owner_email, actor);
    return NextResponse.json({ data }, { status: 201 });
  },
);
