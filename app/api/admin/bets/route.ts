import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { betInputSchema, toBetOutput, ymdToDateOnly } from "@/lib/admin-bets";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/bets — a whole bet (`betInputSchema`, lib/admin-bets.ts).
 * Platform ADMIN. The answer is checked against `betOutputSchema` before it goes.
 */
export const POST = adminRoute<Record<string, never>>("ADMIN", "POST /api/admin/bets", async (req, { user }) => {
  const input = betInputSchema.parse(await readJson(req));
  const bet = await prisma.adminBet.create({
    data: { ...input, deadline: ymdToDateOnly(input.deadline), createdById: user.id, updatedById: user.id },
  });
  logger.info({ adminUserId: user.id, betId: bet.id }, "admin created bet");
  return NextResponse.json({ data: toBetOutput(bet) }, { status: 201 });
});
