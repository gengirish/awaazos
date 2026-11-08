import { NextResponse } from "next/server";

import { createDemoStore } from "@/lib/demo-store";
import { demoStoreCreateSchema, findForbiddenPaymentField } from "@/lib/demo-store-schema";
import { internalRoute, readJson } from "@/lib/internal-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/internal/demo-stores — create a demo store for a prospect
 * (lib/demo-store.ts). 201 when created, 200 with `created: false` when the
 * external_ref already exists. Internal API key only.
 */
export const POST = internalRoute<Record<string, never>>("POST /api/internal/demo-stores", async (req, { actor }) => {
  const raw = await readJson(req);
  const forbidden = findForbiddenPaymentField(raw);
  if (forbidden) {
    return NextResponse.json(
      { error: "payment_details_not_allowed", field: forbidden },
      { status: 400 },
    );
  }
  const input = demoStoreCreateSchema.parse(raw);
  const result = await createDemoStore(input, actor);
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});
