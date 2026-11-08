import { type NextRequest, NextResponse } from "next/server";

import { aiImagePromptSchema, generateAiImage } from "@/lib/ai-image";
import { dropErrorResponse, withVendorCookie } from "@/lib/drops-api";
import { requireActiveBilling, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/vendor/banner/generate — { prompt } → { data: { image } }, a data
 * URI to preview. Saves nothing: "Use this banner" goes through the normal
 * upload route. OWNER, like the banner itself. Contract: lib/ai-image.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("OWNER", undefined, req);
    requireActiveBilling(ctx);
    const { prompt } = aiImagePromptSchema.parse(await req.json());

    const image = await generateAiImage({ vendorId: ctx.vendor.id, plan: ctx.vendor.plan, prompt, kind: "banner" });

    const res = NextResponse.json({ data: { image } });
    res.headers.set("Cache-Control", "private, no-store");
    return withVendorCookie(res, ctx.setVendorCookie);
  } catch (err) {
    return dropErrorResponse(err, "vendor/banner/generate");
  }
}
