import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { ymdToDateOnly } from "@/lib/admin-bets";
import { markerInputSchema, toMarkerOutput } from "@/lib/gtm-timeline";
import { readJson } from "@/lib/internal-api";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/timeline-markers — `{ kind, label, note?, occurredOn }` (lib/gtm-timeline.ts).
 * Platform ADMIN. The answer is checked against `markerOutputSchema` before it goes.
 */
export const POST = adminRoute<Record<string, never>>(
  "ADMIN",
  "POST /api/admin/timeline-markers",
  async (req, { user }) => {
    const input = markerInputSchema.parse(await readJson(req));
    const marker = await prisma.adminTimelineMarker.create({
      data: { ...input, occurredOn: ymdToDateOnly(input.occurredOn), createdById: user.id },
    });
    logger.info({ adminUserId: user.id, markerId: marker.id }, "admin added timeline marker");
    return NextResponse.json({ data: toMarkerOutput(marker) }, { status: 201 });
  },
);
