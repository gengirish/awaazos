import { Prisma, type MenuItem } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { beginIdempotency, getIdempotencyKey } from "@/lib/idempotency";
import { loadMenuCreateContext, prepareMenuItemCreate } from "@/lib/menu-create";
import { prisma } from "@/lib/prisma";
import { tooManyRequests, writeRateLimit } from "@/lib/ratelimit";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { menuBulkBodySchema, type MenuBulkItem } from "@/lib/zod-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MenuBulkResult = {
  created: MenuItem[];
  updated: MenuItem[];
  skipped: { name: string; reason: "not_found" | "duplicate" }[];
};

function withVendorCookie(res: NextResponse, slug: string | null) {
  if (slug) {
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * POST /api/menu/bulk — save the rows a vendor confirmed in the voice menu
 * builder. One transaction:
 *   - rows with `existingMenuItemId` → price update only, compound
 *     `where { id, vendorId }`; an id that isn't this vendor's is skipped as
 *     `not_found` (never touches another tenant, never says whether it exists);
 *   - other rows → created with the same slug / alias / sortOrder rules as
 *     POST /api/menu (lib/menu-create.ts).
 * The same existing id or the same new name twice in one request → the later
 * one is skipped as `duplicate`.
 *
 * 201 `{ data: { created, updated, skipped } }`. Honors `Idempotency-Key`.
 * There is no menu-item plan limit (PLAN_LIMITS has none), so none is enforced.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireVendorRole("CASHIER", undefined, req);
    const vendorId = ctx.vendor.id;

    const rl = await writeRateLimit.check(vendorId);
    if (!rl.ok) return tooManyRequests(rl, "menu-write");

    const body = menuBulkBodySchema.parse(await req.json());

    const idemKey = getIdempotencyKey(req);
    let commitIdem: ((rec: { status: number; body: unknown }) => Promise<void>) | null = null;
    if (idemKey) {
      const outcome = await beginIdempotency({ scope: "menu-bulk", vendorId, idempotencyKey: idemKey });
      if (outcome.kind === "replay") {
        return NextResponse.json(outcome.record.body, { status: outcome.record.status });
      }
      if (outcome.kind === "in_flight") {
        return NextResponse.json(
          { error: "request_in_flight", message: "Same Idempotency-Key is currently being processed." },
          { status: 409 },
        );
      }
      if (outcome.kind === "fresh") commitIdem = outcome.commit;
      // "disabled" → proceed without idempotency.
    }

    const skipped: MenuBulkResult["skipped"] = [];
    const updates: { id: string; name: string; priceInPaise: number }[] = [];
    const creates: MenuBulkItem[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const item of body.items) {
      if (item.existingMenuItemId) {
        if (seenIds.has(item.existingMenuItemId)) {
          skipped.push({ name: item.name, reason: "duplicate" });
          continue;
        }
        seenIds.add(item.existingMenuItemId);
        updates.push({ id: item.existingMenuItemId, name: item.name, priceInPaise: item.priceInPaise });
      } else {
        const k = nameKey(item.name);
        if (seenNames.has(k)) {
          skipped.push({ name: item.name, reason: "duplicate" });
          continue;
        }
        seenNames.add(k);
        creates.push(item);
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const updated: MenuItem[] = [];
        for (const u of updates) {
          const { count } = await tx.menuItem.updateMany({
            where: { id: u.id, vendorId },
            data: { priceInPaise: u.priceInPaise },
          });
          if (count === 0) {
            skipped.push({ name: u.name, reason: "not_found" });
            continue;
          }
          const row = await tx.menuItem.findFirst({ where: { id: u.id, vendorId } });
          if (row) updated.push(row);
        }

        let created: MenuItem[] = [];
        if (creates.length > 0) {
          const menuCtx = await loadMenuCreateContext(tx, vendorId);
          const data = creates.map((c) =>
            prepareMenuItemCreate(menuCtx, vendorId, {
              name: c.name,
              priceInPaise: c.priceInPaise,
              aliases: c.aliases,
              tags: [],
              emoji: c.emoji,
              category: c.category,
              hsnCode: null,
              isPopular: false,
              isAvailable: true,
              showOnline: true,
            }),
          );
          created = await tx.menuItem.createManyAndReturn({ data });
          created.sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return { created, updated };
      },
      { timeout: 15_000 },
    );

    const responseBody = { data: { ...result, skipped } satisfies MenuBulkResult };
    if (commitIdem) await commitIdem({ status: 201, body: responseBody });
    const res = NextResponse.json(responseBody, { status: 201 });
    return withVendorCookie(res, ctx.setVendorCookie);
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // A concurrent create took one of the slugs; nothing was saved — safe to retry.
      return NextResponse.json({ error: "conflict", message: "Menu changed while saving — please try again." }, { status: 409 });
    }
    console.error("[api/menu/bulk]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
