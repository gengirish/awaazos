import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { runRetention } from "@/lib/retention-server";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run the retention cleanup now (platform ADMIN). The daily cron
 * (app/api/cron/retention) already does this; this is for an operator who
 * doesn't want to wait. Idempotent, so a repeat call deletes nothing new.
 */
export async function POST() {
  try {
    await requirePlatformRole("ADMIN");
    return NextResponse.json({ data: await runRetention("admin") });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error(
      { route: "POST /api/admin/retention/run", error: err instanceof Error ? err.message : "unknown" },
      "retention run failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
