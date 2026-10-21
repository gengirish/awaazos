import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { communityCreateSchema } from "@/lib/community";
import { createCommunity } from "@/lib/community-server";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/communities — `{ slug, name, area?, description? }`.
 * Platform ADMIN. Makes an empty community page at /c/<slug> (lib/community.ts);
 * 409 `community_slug_taken` when the link is in use.
 */
export const POST = adminRoute<Record<string, never>>("ADMIN", "POST /api/admin/communities", async (req, { user }) => {
  const input = communityCreateSchema.parse(await readJson(req));
  const community = await createCommunity(input, user.id);
  logger.info({ adminUserId: user.id, communityId: community.id }, "admin created community page");
  return NextResponse.json({ data: community }, { status: 201 });
});
