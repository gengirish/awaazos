import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { id: string };

/** DELETE /api/admin/timeline-markers/[id]. 404 `not_found`. Derived markers have no row and can't be deleted. */
export const DELETE = adminRoute<Params>(
  "ADMIN",
  "DELETE /api/admin/timeline-markers/[id]",
  async (_req, { params, user }) => {
    const res = await prisma.adminTimelineMarker.deleteMany({ where: { id: params.id } });
    if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    logger.info({ adminUserId: user.id, markerId: params.id }, "admin deleted timeline marker");
    return NextResponse.json({ success: true });
  },
);
