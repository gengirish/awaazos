import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/admin-api";
import { ImageUploadError } from "@/lib/blob-image";
import { removeDemoStoreImage, setDemoStoreImage } from "@/lib/demo-store-image";
import { externalRefSchema } from "@/lib/demo-store-schema";
import { assertSalesOwnsDemoStore } from "@/lib/sales-scope";
import type { StoreImageKind } from "@/lib/store-image";

/** POST and DELETE handlers for app/api/admin/demo-stores/[externalRef]/{banner,logo}/route.ts. */
export function demoStoreImageRoutes(kind: StoreImageKind) {
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
  return {
    POST: adminRoute<{ externalRef: string }>(
      "SALES",
      `POST /api/admin/demo-stores/[ref]/${kind}`,
      async (req, { params, actor, user }) => {
        const ref = externalRefSchema.safeParse(params.externalRef);
        if (!ref.success) return notFound();
        await assertSalesOwnsDemoStore(user, actor, ref.data);
        try {
          return NextResponse.json({ data: await setDemoStoreImage(req, ref.data, kind, actor) });
        } catch (err) {
          if (err instanceof ImageUploadError) return NextResponse.json({ error: err.message }, { status: err.status });
          throw err;
        }
      },
    ),
    DELETE: adminRoute<{ externalRef: string }>(
      "SALES",
      `DELETE /api/admin/demo-stores/[ref]/${kind}`,
      async (_req, { params, actor, user }) => {
        const ref = externalRefSchema.safeParse(params.externalRef);
        if (!ref.success) return notFound();
        await assertSalesOwnsDemoStore(user, actor, ref.data);
        await removeDemoStoreImage(ref.data, kind, actor);
        return NextResponse.json({ success: true });
      },
    ),
  };
}
