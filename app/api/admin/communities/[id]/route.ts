import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { communityUpdateSchema } from "@/lib/community";
import { deleteCommunity, updateCommunity } from "@/lib/community-server";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { id: string };

/** PATCH /api/admin/communities/[id] — any of `{ slug, name, area, description }`. Platform ADMIN. */
export const PATCH = adminRoute<Params>("ADMIN", "PATCH /api/admin/communities/[id]", async (req, { params }) => {
  const input = communityUpdateSchema.parse(await readJson(req));
  const community = await updateCommunity(params.id, input);
  return NextResponse.json({ data: community });
});

/** DELETE /api/admin/communities/[id] — the page and its invites; the stores are untouched. */
export const DELETE = adminRoute<Params>(
  "ADMIN",
  "DELETE /api/admin/communities/[id]",
  async (_req, { params, user }) => {
    await deleteCommunity(params.id);
    logger.info({ adminUserId: user.id, communityId: params.id }, "admin deleted community page");
    return NextResponse.json({ success: true });
  },
);
