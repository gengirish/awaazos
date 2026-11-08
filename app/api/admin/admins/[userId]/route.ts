import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { removePlatformAdmin } from "@/lib/admin-invites";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/admin/admins/[userId] — SUPER_ADMIN; an ADMIN goes back to USER (never a SUPER_ADMIN or yourself). */
export const DELETE = adminRoute<{ userId: string }>(
  "SUPER_ADMIN",
  "DELETE /api/admin/admins/[userId]",
  async (_req, { params, user }) => {
    await removePlatformAdmin(params.userId, user.id);
    logger.info(
      { route: "DELETE /api/admin/admins/[userId]", adminUserId: user.id, removedUserId: params.userId },
      "admin removed",
    );
    return NextResponse.json({ success: true });
  },
);
