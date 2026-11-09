import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { betInputSchema, toBetOutput, ymdToDateOnly } from "@/lib/admin-bets";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { id: string };

/** PATCH /api/admin/bets/[id] — the whole bet again, as the edit form sends it. 404 `not_found`. */
export const PATCH = adminRoute<Params>("ADMIN", "PATCH /api/admin/bets/[id]", async (req, { params, user }) => {
  const input = betInputSchema.parse(await readJson(req));
  const res = await prisma.adminBet.updateMany({
    where: { id: params.id },
    data: { ...input, deadline: ymdToDateOnly(input.deadline), updatedById: user.id },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const bet = await prisma.adminBet.findUniqueOrThrow({ where: { id: params.id } });
  logger.info({ adminUserId: user.id, betId: bet.id, decision: bet.decision }, "admin updated bet");
  return NextResponse.json({ data: toBetOutput(bet) });
});

/** DELETE /api/admin/bets/[id]. 404 `not_found`. */
export const DELETE = adminRoute<Params>("ADMIN", "DELETE /api/admin/bets/[id]", async (_req, { params, user }) => {
  const res = await prisma.adminBet.deleteMany({ where: { id: params.id } });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logger.info({ adminUserId: user.id, betId: params.id }, "admin deleted bet");
  return NextResponse.json({ success: true });
});
