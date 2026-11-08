import { NextResponse } from "next/server";
import { z } from "zod";

import { DemoStoreError } from "@/lib/demo-store";
import { internalKeyId, isInternalCaller } from "@/lib/internal-auth";
import { logger } from "@/lib/logger";

/**
 * Wrapper for /api/internal/* handlers: API-key check first (401 before
 * anything is read), then the repo's error shapes. `actor` identifies the key
 * in audit rows without storing it.
 */
export function internalRoute<P>(
  name: string,
  handler: (req: Request, ctx: { params: P; actor: string }) => Promise<Response>,
) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    if (!isInternalCaller(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      return await handler(req, { params: await routeCtx.params, actor: `key:${internalKeyId()}` });
    } catch (err) {
      if (err instanceof DemoStoreError) {
        return NextResponse.json({ error: err.code }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
      }
      logger.error({ route: name, error: err instanceof Error ? err.message : "unknown" }, "internal route failed");
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

/** The JSON body, or a 400-mapped ZodError for anything that is not JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "Body must be JSON" }]);
  }
}
