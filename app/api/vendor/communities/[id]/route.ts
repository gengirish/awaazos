import { NextResponse, type NextRequest } from "next/server";

import { acceptCommunityInvite, CommunityError, leaveCommunity } from "@/lib/community-server";
import { withVendorCookie } from "@/lib/drops-api";
import { logger } from "@/lib/logger";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

/**
 * The store's side of a community page (lib/community.ts), OWNER only:
 *   POST   — accept the invite, so the store is listed on /c/<slug>;
 *   DELETE — decline the invite or leave the page.
 * Scoped to the signed-in vendor's own row, so another store's id or an
 * unknown page are the same 404. Not billing-gated: listing is not a sale.
 */
export async function POST(req: NextRequest, props: Props) {
  return handle(req, props, "POST /api/vendor/communities/[id]", async (vendorId, id) => {
    await acceptCommunityInvite(vendorId, id);
    return NextResponse.json({ data: { id, accepted: true } });
  });
}

export async function DELETE(req: NextRequest, props: Props) {
  return handle(req, props, "DELETE /api/vendor/communities/[id]", async (vendorId, id) => {
    await leaveCommunity(vendorId, id);
    return NextResponse.json({ success: true });
  });
}

async function handle(
  req: NextRequest,
  props: Props,
  route: string,
  run: (vendorId: string, communityId: string) => Promise<NextResponse>,
) {
  try {
    const { id } = await props.params;
    const ctx = await requireVendorRole("OWNER", undefined, req);
    return withVendorCookie(await run(ctx.vendor.id, id), ctx.setVendorCookie);
  } catch (err) {
    if (err instanceof AuthError || err instanceof CommunityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error({ route, error: err instanceof Error ? err.message : "unknown" }, "community route failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
