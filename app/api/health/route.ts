import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe — answers as long as the Node process can serve requests.
 * Used by Vercel's Edge platform health-check and any external uptime monitor
 * (cron-job.org / UptimeRobot / Better Stack).
 *
 * Stays cheap: no DB / no Redis / no upstream calls. If this returns 200,
 * the process is alive. Use /api/ready for "alive AND able to serve work".
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "awaazos",
      ts: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
