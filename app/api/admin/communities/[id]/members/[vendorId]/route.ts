import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { removeStore } from "@/lib/community-server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/admin/communities/[id]/members/[vendorId] — take a store (or its invite) off the page. */
export const DELETE = adminRoute<{ id: string; vendorId: string }>(
  "ADMIN",
  "DELETE /api/admin/communities/[id]/members/[vendorId]",
  async (_req, { params, user }) => {
    await removeStore(params.id, params.vendorId);
    logger.info(
      { adminUserId: user.id, communityId: params.id, vendorId: params.vendorId },
      "admin removed store from community page",
    );
    return NextResponse.json({ success: true });
  },
);
