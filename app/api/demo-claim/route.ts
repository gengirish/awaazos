import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { claimDemoStore, DemoStoreError } from "@/lib/demo-store";
import { logger } from "@/lib/logger";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(16).max(256),
  // Optional: an existing account keeps its own name.
  name: z.string().trim().min(1).max(80).optional(),
  // A new password meets the policy in claimDemoStore; an existing one is only compared.
  password: z.string().min(1).max(128),
  sampleOrders: z.enum(["archive", "delete"]).default("archive"),
});

/**
 * POST /api/demo-claim — public. The prospect redeems a handover link from
 * /claim/[token]: sets their own password (or, when the invited email already
 * has an account, enters that account's password) and takes the store
 * (lib/demo-store.ts). "No such token", "expired" and "used" are one error.
 * The response sets `awz_vendor` so the first sign-in lands in this store,
 * not in another one the account already runs.
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

  try {
    const { slug } = await claimDemoStore(body);
    const res = NextResponse.json({ data: { slug } });
    res.cookies.set("awz_vendor", slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err) {
    if (err instanceof DemoStoreError) {
      return NextResponse.json(
        err.reason ? { error: err.code, reason: err.reason } : { error: err.code },
        { status: err.status },
      );
    }
    logger.error({ route: "POST /api/demo-claim", error: err instanceof Error ? err.message : "unknown" }, "claim failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
