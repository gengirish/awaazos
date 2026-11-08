import { cache } from "react";

import { prisma } from "@/lib/prisma";

/**
 * What the store's app (lib/store-app.ts) needs: the storefront gate, then an
 * allowlist of what the public page already shows. Never `phone` / `email`.
 *
 * `cache` keeps it to one query per request across the /s/[slug] layout's
 * metadata and viewport. Read on request only: no timers.
 */
export const loadStoreApp = cache(async (slug: string) =>
  prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: {
      slug: true,
      name: true,
      isDemo: true,
      logoUrl: true,
      settings: { select: { theme: true } },
    },
  }),
);
