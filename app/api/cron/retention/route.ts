import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { runRetention } from "@/lib/retention-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily Vercel Cron (vercel.json): deletes voice parse logs and receipts past
 * lib/retention.ts. Scheduled a few minutes after trial-reminders so it finds
 * Neon already awake; once a day is far above Neon's idle timeout either way.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ data: await runRetention("cron") });
  } catch (err) {
    console.error(
      JSON.stringify({ event: "retention_cron_failed", error: err instanceof Error ? err.name : "unknown" }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
