import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { sendTrialReminders } from "@/lib/trial-alerts-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily Vercel Cron (vercel.json): "your free trial ends soon" emails. Once a
 * day is far above Neon's idle timeout, so it can't keep the database awake,
 * and it only reads: billing stays lazy (lib/plan.ts).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ data: await sendTrialReminders() });
  } catch (err) {
    console.error(
      JSON.stringify({ event: "trial_reminders_cron_failed", error: err instanceof Error ? err.name : "unknown" }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
