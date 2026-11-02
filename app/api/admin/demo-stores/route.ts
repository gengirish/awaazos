import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { createDemoStore } from "@/lib/demo-store";
import { demoStoreCreateSchema, findForbiddenPaymentField } from "@/lib/demo-store-schema";
import { readJson } from "@/lib/internal-api";
import { assertSalesMayBuild } from "@/lib/sales-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/demo-stores — the internal create (POST /api/internal/demo-stores)
 * for a signed-in platform ADMIN or SALES user, from /admin/demo-stores/new. Same
 * body, same rules; the 20-a-day limit counts per person. A SALES user can't build
 * on a ref someone else holds (409 lead_taken).
 */
export const POST = adminRoute<Record<string, never>>("SALES", "POST /api/admin/demo-stores", async (req, { actor, user }) => {
  const raw = await readJson(req);
  const forbidden = findForbiddenPaymentField(raw);
  if (forbidden) {
    return NextResponse.json({ error: "payment_details_not_allowed", field: forbidden }, { status: 400 });
  }
  const input = demoStoreCreateSchema.parse(raw);
  await assertSalesMayBuild(user, actor, input.external_ref);
  const result = await createDemoStore(input, actor);
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});
