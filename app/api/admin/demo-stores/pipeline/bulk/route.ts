import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute } from "@/lib/admin-api";
import { applyPipelineAction } from "@/lib/demo-pipeline-server";
import { DemoStoreError } from "@/lib/demo-store";
import { externalRefSchema } from "@/lib/demo-store-schema";
import { readJson } from "@/lib/internal-api";
import { assertSalesOwnsDemoStore } from "@/lib/sales-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({ refs: z.array(externalRefSchema).min(1).max(100), action: z.literal("archive") })
  .strict();

/**
 * POST /api/admin/demo-stores/pipeline/bulk — archive several stores. One write per
 * store, in sequence, so one stale store never rolls back the rest. Bulk sends go
 * through the single-store route, one at a time, as the admin confirms each.
 */
export const POST = adminRoute<Record<string, never>>(
  "SALES",
  "POST /api/admin/demo-stores/pipeline/bulk",
  async (req, { actor, user }) => {
    const body = bodySchema.parse(await readJson(req));
    const succeeded: { ref: string; event_id: string | undefined }[] = [];
    const failed: { ref: string; error: string }[] = [];
    for (const ref of new Set(body.refs)) {
      try {
        await assertSalesOwnsDemoStore(user, actor, ref);
        const { event_id } = await applyPipelineAction(ref, { action: "archive", reason: "manual" }, actor);
        succeeded.push({ ref, event_id });
      } catch (err) {
        if (!(err instanceof DemoStoreError)) throw err;
        failed.push({ ref, error: err.code });
      }
    }
    return NextResponse.json({ data: { succeeded, failed } });
  },
);
