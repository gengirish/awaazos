import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { STALL_TYPES } from "@/lib/constants";
import { formatINR } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { buildQrUrl, buildUpiCollectLink } from "@/lib/upi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public storefront — the only unauthenticated page that reads tenant data.
 *
 * Three rules hold this route together:
 *
 *   1. Opt-in only. `VendorSettings.publishStorefront` defaults to false, so a
 *      menu and its prices go public exactly when the vendor says so.
 *   2. A vendor who has not opted in is indistinguishable from one who does not
 *      exist — both 404. Same reasoning as the cross-tenant 404 rule in
 *      lib/rbac.ts: a 403 here would confirm the stall is on AwaazOS.
 *   3. The `select` is an allowlist, never a spread. `Vendor.phone` and
 *      `Vendor.email` are contact PII and must not reach a public page;
 *      `upiId` is here only because collecting payment is the point.
 */

type StorefrontVendor = NonNullable<Awaited<ReturnType<typeof loadStorefront>>>;

/**
 * Deduped across generateMetadata() and the page render — React `cache` keeps
 * this to a single query per request.
 */
const loadStorefront = cache(async (slug: string) => {
  return prisma.vendor.findFirst({
    where: {
      slug,
      isActive: true,
      settings: { is: { publishStorefront: true } },
    },
    select: {
      slug: true,
      name: true,
      city: true,
      state: true,
      stallType: true,
      logoUrl: true,
      upiId: true,
      upiName: true,
      menuItems: {
        where: { isAvailable: true },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          emoji: true,
          category: true,
          priceInPaise: true,
          isPopular: true,
          imageUrl: true,
        },
      },
    },
  });
});

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const vendor = await loadStorefront(params.slug);
  if (!vendor) return { title: "Not found — AwaazOS" };

  const place = [vendor.city, vendor.state].filter(Boolean).join(", ");
  const title = `${vendor.name} — Menu`;
  const description = place
    ? `Menu and prices for ${vendor.name}, ${place}. Pay by UPI.`
    : `Menu and prices for ${vendor.name}. Pay by UPI.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

function stallTypeLabel(value: StorefrontVendor["stallType"]): string {
  return STALL_TYPES.find((t) => t.value === value)?.label ?? "Stall";
}

type StorefrontItems = StorefrontVendor["menuItems"];

/** Preserves the query ordering; no re-sort. */
function groupByCategory(items: StorefrontItems): [string, StorefrontItems][] {
  const groups = new Map<string, StorefrontItems>();
  for (const item of items) {
    const bucket = groups.get(item.category);
    if (bucket) bucket.push(item);
    else groups.set(item.category, [item]);
  }
  return Array.from(groups.entries());
}

export default async function StorefrontPage({ params }: { params: { slug: string } }) {
  const vendor = await loadStorefront(params.slug);
  if (!vendor) notFound();

  const categories = groupByCategory(vendor.menuItems);
  const payeeName = vendor.upiName ?? vendor.name;
  const upiLink = vendor.upiId
    ? buildUpiCollectLink({ upiId: vendor.upiId, name: payeeName })
    : null;
  const place = [vendor.city, vendor.state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-awaaz-cream/30">
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to menu
      </a>

      <header className="border-b border-border/60 bg-background">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-6 sm:px-6">
          {vendor.logoUrl ? (
            <Image
              src={vendor.logoUrl}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-full border border-border/60 object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-2xl font-bold text-primary"
            >
              {vendor.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-foreground">
              {vendor.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stallTypeLabel(vendor.stallType)}
              {place ? ` · ${place}` : ""}
            </p>
          </div>
        </div>
      </header>

      <main id="menu" className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <h2 className="sr-only">Menu</h2>

        {categories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
            This stall has not published any items yet. Please check back soon.
          </p>
        ) : (
          <div className="space-y-8">
            {categories.map(([category, items]) => (
              <section key={category} aria-labelledby={`cat-${category}`}>
                <h3
                  id={`cat-${category}`}
                  className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {category}
                </h3>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <span aria-hidden="true" className="w-11 shrink-0 text-center text-2xl">
                          {item.emoji}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {item.name}
                        {item.isPopular ? (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-xs font-semibold text-primary">
                            Popular
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatINR(item.priceInPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {upiLink ? (
          <section
            aria-labelledby="pay-heading"
            className="mt-8 rounded-xl border border-border/60 bg-background px-4 py-6 text-center"
          >
            <h3 id="pay-heading" className="font-display text-lg font-semibold text-foreground">
              Scan to pay
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Any UPI app. Enter the amount the vendor tells you.
            </p>
            <Image
              src={buildQrUrl(upiLink, 220)}
              alt={`UPI QR code to pay ${payeeName}`}
              width={220}
              height={220}
              unoptimized
              className="mx-auto mt-4 rounded-lg border border-border/60 bg-white p-2"
            />
            <p className="mt-3 font-mono text-sm text-muted-foreground">{vendor.upiId}</p>
            <a
              href={upiLink}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground sm:hidden"
            >
              Open UPI app
            </a>
          </section>
        ) : null}
      </main>

      <footer className="pb-10 pt-4 text-center">
        <Link href="/" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          Billing by AwaazOS — Bol. Bill. Becho.
        </Link>
      </footer>
    </div>
  );
}
