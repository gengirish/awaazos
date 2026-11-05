import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { applyPipelineAction, pipelineActionSchema } from "@/lib/demo-pipeline-server";
import { externalRefSchema } from "@/lib/demo-store-schema";
import { readJson } from "@/lib/internal-api";
import { assertSalesOwnsDemoStore } from "@/lib/sales-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/demo-stores/{external_ref}/pipeline — platform ADMIN, or the
 * SALES user who built the store. One outreach action (`action` in the body:
 * sent, snooze, archive, restore, claim_link, contact, undo) and its audit row.
 * Returns the audit row's id for undo. Sends nothing except the claim email.
 */
export const POST = adminRoute<{ externalRef: string }>(
  "SALES",
  "POST /api/admin/demo-stores/[ref]/pipeline",
  async (req, { params, actor, user }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertSalesOwnsDemoStore(user, actor, ref.data);
    const body = pipelineActionSchema.parse(await readJson(req));
    return NextResponse.json({ data: await applyPipelineAction(ref.data, body, actor) });
  },
);
