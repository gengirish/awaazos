import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";

import { STORY_SIZE } from "@/lib/drop-story-image";
import { dropErrorResponse, notFound, withVendorCookie } from "@/lib/drops-api";
import { requireVendorRole } from "@/lib/rbac";
import { referralSignUpUrl } from "@/lib/referral";
import { referralLinkLabel } from "@/lib/referral-message";
import { ReferralStoryCard } from "@/lib/referral-story-image";
import { appBaseUrl } from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/vendor/referrals/story-image — 1080×1920 PNG inviting other sellers
 * to sign up with this store's referral link (Settings → Refer a seller).
 * OWNER only; a demo store gets 404 (demo stores don't refer). The link uses
 * the configured origin (`appBaseUrl`), never the request Host header, so it
 * matches the link on the page. Never cached.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    if (ctx.vendor.isDemo) throw notFound();

    const linkLabel = referralLinkLabel(referralSignUpUrl(appBaseUrl(), ctx.vendor.slug));
    const image = new ImageResponse(<ReferralStoryCard storeName={ctx.vendor.name} linkLabel={linkLabel} />, STORY_SIZE);
    const res = new NextResponse(image.body, { status: image.status, headers: image.headers });
    res.headers.set("Cache-Control", "private, no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "vendor/referrals/story-image");
  }
}
