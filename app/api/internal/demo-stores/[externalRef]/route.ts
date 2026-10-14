import { NextResponse } from "next/server";

import { deleteDemoStore, getDemoStore } from "@/lib/demo-store";
import { externalRefSchema } from "@/lib/demo-store-schema";
import { internalRoute } from "@/lib/internal-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { externalRef: string };

/** GET /api/internal/demo-stores/{external_ref} — store summary and public URL. */
export const GET = internalRoute<Params>("GET /api/internal/demo-stores/[ref]", async (_req, { params }) => {
  const ref = externalRefSchema.safeParse(params.externalRef);
  const store = ref.success ? await getDemoStore(ref.data) : null;
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: store });
});

/** DELETE /api/internal/demo-stores/{external_ref} — demo stores only (a claimed store → 409). */
export const DELETE = internalRoute<Params>(
  "DELETE /api/internal/demo-stores/[ref]",
  async (_req, { params, actor }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteDemoStore(ref.data, actor);
    return NextResponse.json({ success: true });
  },
);
