import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Far above any real menu; keeps one request from holding a transaction open. */
const MAX_REORDER_IDS = 500;

const bodySchema = z
  .object({
    ids: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(MAX_REORDER_IDS)
      .refine((ids) => new Set(ids).size === ids.length, "Each id may appear once"),
  })
  .strict();

/**
 * POST /api/menu/reorder — save the menu's display order in one request.
 * `{ ids }` is the whole menu in the order the vendor wants; each row's
 * `sortOrder` becomes its index, all in one transaction. Every write is
 * compound `where { id, vendorId }`, so an id that isn't this vendor's matches
 * nothing and is ignored (never touched, never reported as existing).
 *
 * CASHIER, the same role `PATCH /api/menu/[id]` asks for `sortOrder`.
 * 200 `{ data: { updated } }` — the number of this vendor's rows that were set.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendorId = ctx.vendor.id;

    const rl = await writeRateLimit.check(vendorId);
    if (!rl.ok) return tooManyRequests(rl, "menu-write");

    const { ids } = bodySchema.parse(await req.json());

    const results = await prisma.$transaction(
      ids.map((id, index) =>
        prisma.menuItem.updateMany({
          where: { id, vendorId },
          data: { sortOrder: index },
        }),
      ),
    );
    const updated = results.reduce((sum, r) => sum + r.count, 0);

    const res = NextResponse.json({ data: { updated } });
    if (ctx.setVendorCookie) {
      res.cookies.set("awz_vendor", ctx.setVendorCookie, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("[api/menu/reorder]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
