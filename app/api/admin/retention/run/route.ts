import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { runRetention } from "@/lib/retention-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run the retention cleanup now (platform ADMIN). The daily cron
 * (app/api/cron/retention) already does this; this is for an operator who
 * doesn't want to wait. Idempotent, so a repeat call deletes nothing new.
 * Below ADMIN it answers 404 like every other admin route (lib/admin-api.ts).
 */
export const POST = adminRoute<Record<string, never>>("ADMIN", "POST /api/admin/retention/run", async () =>
  NextResponse.json({ data: await runRetention("admin") }),
);
