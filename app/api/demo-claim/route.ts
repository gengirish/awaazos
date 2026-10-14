import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { claimDemoStore, DemoStoreError } from "@/lib/demo-store";
import { logger } from "@/lib/logger";
import { checkPasswordPolicy } from "@/lib/password-strength";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128),
  sampleOrders: z.enum(["archive", "delete"]).default("archive"),
});

/**
 * POST /api/demo-claim — public. The prospect redeems a handover link from
 * /claim/[token]: sets their own password and takes the store (lib/demo-store.ts).
 * "No such token", "expired" and "used" are one error.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const rl = await authRateLimit.check(`demo-claim:${getClientIp(req)}`);
  if (!rl.ok) return tooManyRequests(rl, "demo-claim");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }
  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) return NextResponse.json({ error: "weak_password", reason: policy.reason }, { status: 400 });

  try {
    const { slug } = await claimDemoStore(body);
    return NextResponse.json({ data: { slug } });
  } catch (err) {
    if (err instanceof DemoStoreError) return NextResponse.json({ error: err.code }, { status: err.status });
    logger.error({ route: "POST /api/demo-claim", error: err instanceof Error ? err.message : "unknown" }, "claim failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
