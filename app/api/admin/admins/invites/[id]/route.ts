import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { revokeAdminInvite } from "@/lib/admin-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/admin/admins/invites/[id] — SUPER_ADMIN; voids an unused admin invite. */
export const DELETE = adminRoute<{ id: string }>(
  "SUPER_ADMIN",
  "DELETE /api/admin/admins/invites/[id]",
  async (_req, { params }) => {
    await revokeAdminInvite(params.id);
    return NextResponse.json({ success: true });
  },
);
