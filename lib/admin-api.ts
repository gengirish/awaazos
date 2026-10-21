import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { z } from "zod";

import { AdminInviteError } from "@/lib/admin-invites";
import { CommunityError } from "@/lib/community-server";
import { DemoStoreError } from "@/lib/demo-store";
import { logger } from "@/lib/logger";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

type PlatformUser = Awaited<ReturnType<typeof requirePlatformRole>>["user"];

/**
 * Wrapper for /api/admin/* handlers behind a platform role. The role is re-read
 * from the database on every call; anyone below it gets the same 404 as an
 * unknown route (as /api/admin/vendors/[id]/free-access does). `actor` is what
 * demo-store audit rows record for this admin.
 */
export function adminRoute<P>(
  role: UserRole,
  name: string,
  handler: (req: Request, ctx: { params: P; user: PlatformUser; actor: string }) => Promise<Response>,
) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    let user: PlatformUser;
    try {
      ({ user } = await requirePlatformRole(role));
    } catch (err) {
      if (err instanceof AuthError) return NextResponse.json({ error: "Not found" }, { status: 404 });
      throw err;
    }
    try {
      return await handler(req, { params: await routeCtx.params, user, actor: `admin:${user.id}` });
    } catch (err) {
      if (err instanceof DemoStoreError || err instanceof AdminInviteError || err instanceof CommunityError) {
        return NextResponse.json({ error: err.code }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
      }
      logger.error({ route: name, error: err instanceof Error ? err.message : "unknown" }, "admin route failed");
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
