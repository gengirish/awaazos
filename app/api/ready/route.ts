import { NextResponse } from "next/server";

import { getKv } from "@/lib/kv";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2_000;

type Probe = { name: string; ok: boolean; latencyMs: number; error?: string };

async function probe<T>(name: string, fn: () => Promise<T>): Promise<Probe> {
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe_timeout")), PROBE_TIMEOUT_MS),
      ),
    ]);
    return { name, ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * Readiness probe — returns 200 only when every critical dependency answers.
 * Returns 503 on any failure so a load balancer / Vercel will pull this
 * instance out of rotation. Cheap probes (DB SELECT 1, Redis PING) with
 * a 2-second timeout per dependency to avoid hanging the probe under load.
 *
 * Use this for synthetic uptime checks (Better Stack, cron-job.org) — pages
 * the founder when the app loses any dependency.
 */
export async function GET() {
  const probes = await Promise.all([
    probe("database", () => prisma.$queryRaw`SELECT 1`),
    probe("redis", async () => {
      const kv = getKv();
      if (!kv) throw new Error("kv_not_configured");
      const result = await kv.ping();
      if (result !== "PONG") throw new Error(`unexpected_ping=${result}`);
    }),
  ]);

  const allOk = probes.every((p) => p.ok);
  return NextResponse.json(
    {
      status: allOk ? "ready" : "degraded",
      service: "awaazos",
      probes,
      ts: new Date().toISOString(),
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
