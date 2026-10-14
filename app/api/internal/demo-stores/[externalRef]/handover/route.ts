import { NextResponse } from "next/server";

import { createHandover } from "@/lib/demo-store";
import { demoHandoverSchema, externalRefSchema } from "@/lib/demo-store-schema";
import { internalRoute, readJson } from "@/lib/internal-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/internal/demo-stores/{external_ref}/handover — a one-time claim
 * URL (7 days) for the prospect. Creates no account and sends nothing: the
 * caller passes the link on themselves.
 */
export const POST = internalRoute<{ externalRef: string }>(
  "POST /api/internal/demo-stores/[ref]/handover",
  async (req, { params, actor }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = demoHandoverSchema.parse(await readJson(req));
    const data = await createHandover(ref.data, body.owner_email, actor);
    return NextResponse.json({ data }, { status: 201 });
  },
);
