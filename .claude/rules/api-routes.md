---
description: Next.js App Router API conventions for AwaazOS
paths: ["app/api/**/*.ts"]
---

<!-- Generated from .cursor/rules/api-routes.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->

# API Route Conventions — AwaazOS

## Route template

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireVendorRole, AuthError } from "@/lib/rbac";

const bodySchema = z.object({ /* ... */ });

export async function POST(req: NextRequest) {
  try {
    const { vendor } = await requireVendorRole("CASHIER");
    const body = bodySchema.parse(await req.json());

    const result = await prisma.entity.create({
      data: { ...body, vendorId: vendor.id },
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    console.error("[api]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

## Response shapes (consistent across the app)

| Method | Success | Status |
|---|---|---|
| `GET` (list) | `{ data: T[], page?, total?, hasMore? }` | 200 |
| `GET` (single) | `{ data: T }` or `{ error: "Not found" }` | 200 / 404 |
| `POST` (create) | `{ data: T }` | 201 |
| `PATCH` / `PUT` | `{ data: T }` | 200 |
| `DELETE` | `{ success: true }` | 200 |
| Validation fail | `{ error: string, issues?: ZodIssue[] }` | 400 |
| Auth fail | `{ error: string }` | 401 / 403 |
| Plan gate | `{ error: "Plan upgrade required", requiredPlan: "STARTER" }` | 402 |
| Not found | `{ error: "Not found" }` | 404 (don't leak existence cross-tenant) |
| Server error | `{ error: "Internal server error" }` | 500 |

## File placement

- `app/api/<resource>/route.ts` — collection (GET list, POST create)
- `app/api/<resource>/[id]/route.ts` — item (GET, PATCH, DELETE)
- `app/api/<resource>/[id]/<action>/route.ts` — sub-actions
- `app/api/webhooks/<provider>/route.ts` — external webhooks (signature-verified)

## Webhook routes

- Skip `requireVendorRole` (no session). Verify HMAC signature first.
- Add the path to the `auth.config.ts` `authorized` allowlist so middleware
  doesn't redirect them.
- Always return 200 to acknowledge receipt — re-queue work via BullMQ if
  the handler is slow.

## Pagination defaults

- Page size: 20. Max: 100.
- Cursor pagination preferred for transactions (`?cursor=<id>&limit=20`).

## Caching

- `export const dynamic = "force-dynamic"` for any vendor-scoped route
  (do NOT cache cross-tenant).
- `export const runtime = "nodejs"` — Prisma not edge-safe.
