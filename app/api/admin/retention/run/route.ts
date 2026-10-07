import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getRetentionQueue } from "@/lib/queues";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Enqueue one retention maintenance run.
 *
 * Platform ADMIN only, and nothing calls it on a schedule yet: there is no
 * cron and no "Run now" button, so retention runs only when an admin POSTs
 * here by hand. The per-day jobId makes repeat calls on the same UTC day a no-op.
 */
export async function POST() {
  try {
    const { user } = await requirePlatformRole("ADMIN");
    const day = utcDayKey();
    const jobId = `retention:${day}`;

    const job = await getRetentionQueue().add(
      "retention-run",
      { requestedBy: "admin", requestedByUserId: user.id },
      {
        jobId,
        // one run per day by default; can still trigger a second run manually
        // by changing jobId logic in future if needed.
      },
    );

    return NextResponse.json({ ok: true, queued: true, jobId: job.id }, { status: 202 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error(
      { route: "POST /api/admin/retention/run", error: err instanceof Error ? err.message : "unknown" },
      "retention enqueue failed",
    );
    return NextResponse.json({ error: "Could not enqueue retention run" }, { status: 500 });
  }
}

