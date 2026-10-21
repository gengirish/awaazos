import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { communityInviteSchema } from "@/lib/community";
import { inviteStore } from "@/lib/community-server";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/communities/[id]/members — `{ store }`: a store link or slug.
 * Platform ADMIN. Invites the store; it is listed only after its OWNER accepts
 * in Settings → Online store. 404 `store_not_found`, 409 `demo_store` /
 * `already_invited`.
 */
export const POST = adminRoute<{ id: string }>(
  "ADMIN",
  "POST /api/admin/communities/[id]/members",
  async (req, { params, user }) => {
    const { store } = communityInviteSchema.parse(await readJson(req));
    const invited = await inviteStore(params.id, store);
    logger.info(
      { adminUserId: user.id, communityId: params.id, vendorId: invited.vendorId },
      "admin invited store to community page",
    );
    return NextResponse.json({ data: invited }, { status: 201 });
  },
);
