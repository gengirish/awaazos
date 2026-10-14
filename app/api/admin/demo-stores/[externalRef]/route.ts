import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { deleteDemoStore } from "@/lib/demo-store";
import { externalRefSchema } from "@/lib/demo-store-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/admin/demo-stores/{external_ref} — platform ADMIN; demo stores only (a claimed store → 409). */
export const DELETE = adminRoute<{ externalRef: string }>(
  "ADMIN",
  "DELETE /api/admin/demo-stores/[ref]",
  async (_req, { params, actor }) => {
    const ref = externalRefSchema.safeParse(params.externalRef);
    if (!ref.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteDemoStore(ref.data, actor);
    return NextResponse.json({ success: true });
  },
);
