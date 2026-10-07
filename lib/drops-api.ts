/**
 * Shared plumbing for the vendor drops API routes (server-only).
 */

import type { Drop, DropItem, MenuItem, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canTransition, effectiveDropStatus, remainingQty } from "@/lib/drops";
import { dbDateToYmd } from "@/lib/drops-time";
import { AuthError } from "@/lib/rbac";

export const DROP_STATUSES = ["DRAFT", "OPEN", "CLOSED", "FROZEN", "FULFILLED"] as const;

/** Storefront orders that count as "real" for a drop (not cancelled). */
export const liveDropOrderWhere: Prisma.TransactionWhereInput = {
  source: "STOREFRONT",
  fulfilmentStatus: { not: "CANCELLED" },
};

/** Thrown inside handlers / transactions to short-circuit with a 4xx. */
export class DropApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

export const notFound = () => new DropApiError(404, { error: "Not found" });
export const conflict = (error: string, extra: Record<string, unknown> = {}) =>
  new DropApiError(409, { error, ...extra });

export function withVendorCookie(res: NextResponse, slug: string | null) {
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

export function dropErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof DropApiError) return NextResponse.json(err.body, { status: err.status });
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** 400 in the same shape as a Zod failure, pointing at the offending item rows. */
export function unknownMenuItems(items: { menuItemId: string }[], known: Set<string>): DropApiError | null {
  const issues = items.flatMap((it, i) =>
    known.has(it.menuItemId)
      ? []
      : [{ code: "custom", path: ["items", i, "menuItemId"], message: "This item isn't in your menu" }],
  );
  return issues.length ? new DropApiError(400, { error: "Invalid input", issues }) : null;
}

export function allowedTransitions(drop: Pick<Drop, "status" | "opensAt" | "closesAt">, now: Date) {
  const eff = effectiveDropStatus(drop, now);
  return DROP_STATUSES.filter((to) => canTransition(eff, to));
}

type DropWithItems = Drop & {
  items: (DropItem & { menuItem: Pick<MenuItem, "name" | "emoji"> })[];
};

/** Wire shape for a single drop (GET /api/drops/[id], PATCH status, PUT). */
export function serializeDrop(
  drop: DropWithItems,
  opts: { sold: Map<string, number>; orderCount: number; now: Date },
) {
  return {
    id: drop.id,
    title: drop.title,
    note: drop.note,
    date: dbDateToYmd(drop.date),
    fulfilmentMode: drop.fulfilmentMode,
    fulfilmentStartsAt: drop.fulfilmentStartsAt.toISOString(),
    fulfilmentEndsAt: drop.fulfilmentEndsAt.toISOString(),
    pickupNote: drop.pickupNote,
    deliveryFeePaise: drop.deliveryFeePaise,
    opensAt: drop.opensAt?.toISOString() ?? null,
    closesAt: drop.closesAt.toISOString(),
    showEverydayMenu: drop.showEverydayMenu,
    status: drop.status,
    effectiveStatus: effectiveDropStatus(drop, opts.now),
    allowedTransitions: allowedTransitions(drop, opts.now),
    frozenAt: drop.frozenAt?.toISOString() ?? null,
    orderCount: opts.orderCount,
    items: [...drop.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => {
        const sold = opts.sold.get(i.id) ?? 0;
        return {
          id: i.id,
          menuItemId: i.menuItemId,
          name: i.menuItem.name,
          emoji: i.menuItem.emoji,
          priceInPaise: i.priceInPaise,
          maxQty: i.maxQty,
          perOrderLimit: i.perOrderLimit,
          sortOrder: i.sortOrder,
          sold,
          remaining: remainingQty(i.maxQty, sold),
        };
      }),
  };
}

export const dropWithItemsInclude = {
  items: { include: { menuItem: { select: { name: true, emoji: true } } } },
} satisfies Prisma.DropInclude;
