import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute } from "@/lib/admin-api";
import { createAdminInvite } from "@/lib/admin-invites";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

/**
 * POST /api/admin/admins/invites — SUPER_ADMIN. A one-time link that makes
 * `email` a platform ADMIN (lib/admin-invites.ts). Sends nothing; the link is
 * returned once and only its hash is stored.
 */
export const POST = adminRoute<Record<string, never>>(
  "SUPER_ADMIN",
  "POST /api/admin/admins/invites",
  async (req, { user }) => {
    const body = bodySchema.parse(await readJson(req));
    const data = await createAdminInvite(body.email, user.id);
    logger.info(
      { route: "POST /api/admin/admins/invites", adminUserId: user.id, inviteId: data.id },
      "admin invite created",
    );
    return NextResponse.json({ data }, { status: 201 });
  },
);
