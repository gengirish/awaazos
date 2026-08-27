import type { Metadata } from "next";
import { MapPin, QrCode, Sparkles, UtensilsCrossed } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CopyUpiId } from "@/components/storefront/CopyUpiId";
import { STALL_TYPES } from "@/lib/constants";
import { formatINRCompact } from "@/lib/currency";
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
 *      `settings.theme` is the vendor's chosen brand colour — the only field
 *      read off VendorSettings besides the publish gate itself.
 */

type StorefrontVendor = NonNullable<Awaited<ReturnType<typeof loadStorefront>>>;

/** Themes with a `[data-theme=…]` block in globals.css; anything else stays saffron. */
const BRAND_THEMES = new Set(["green", "amber", "red", "blue", "purple"]);

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
      settings: { select: { theme: true } },
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

/** Category names are vendor-authored free text; anchors must survive spaces and `&`. */
function categoryAnchor(category: string, index: number): string {
  const slug = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cat-${slug || "items"}-${index}`;
}

function MenuRow({ item }: { item: StorefrontItems[number] }) {
  return (
    <li className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-primary/[0.04] sm:gap-4 sm:px-4">
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-border/60"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl"
        >
          {item.emoji}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-[15px] font-semibold text-foreground">{item.name}</span>
        {item.isPopular ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Popular
          </span>
        ) : null}
      </span>

      <span className="shrink-0 rounded-lg bg-muted/70 px-2.5 py-1 font-mono text-sm font-bold tabular-nums text-foreground">
        {formatINRCompact(item.priceInPaise)}
      </span>
    </li>
  );
}

export default async function StorefrontPage({ params }: { params: { slug: string } }) {
  const vendor = await loadStorefront(params.slug);
  if (!vendor) notFound();

  const categories = groupByCategory(vendor.menuItems);
  const popular = vendor.menuItems.filter((i) => i.isPopular).slice(0, 6);
  const payeeName = vendor.upiName ?? vendor.name;
  const upiLink = vendor.upiId
    ? buildUpiCollectLink({ upiId: vendor.upiId, name: payeeName })
    : null;
  const place = [vendor.city, vendor.state].filter(Boolean).join(", ");
  const rawTheme = vendor.settings?.theme ?? "orange";
  const theme = BRAND_THEMES.has(rawTheme) ? rawTheme : undefined;
  const itemCount = vendor.menuItems.length;

  return (
    <div data-theme={theme} className="min-h-screen bg-awaaz-cream/40">
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to menu
      </a>

      {/* Brand band. The vendor's theme colour is the only thing that differs
          between one storefront and the next, so it carries the whole identity. */}
      <header className="relative overflow-hidden border-b border-border/50 bg-gradient-to-b from-primary/20 via-primary/[0.07] to-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(hsl(var(--primary)) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            maskImage: "linear-gradient(to bottom, black, transparent 70%)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-2xl px-4 pb-7 pt-10 sm:px-6 sm:pb-9 sm:pt-14">
          <div className="flex flex-col items-center text-center">
            {vendor.logoUrl ? (
              <Image
                src={vendor.logoUrl}
                alt=""
                width={88}
                height={88}
                className="h-[88px] w-[88px] shrink-0 rounded-2xl bg-background object-cover shadow-lg ring-4 ring-background"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-2xl bg-primary font-display text-4xl font-bold text-primary-foreground shadow-lg ring-4 ring-background"
              >
                {vendor.name.slice(0, 1).toUpperCase()}
              </div>
            )}

            <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-awaaz-charcoal sm:text-4xl">
              {vendor.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <UtensilsCrossed className="h-3.5 w-3.5" aria-hidden="true" />
                {stallTypeLabel(vendor.stallType)}
              </span>
              {place ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {place}
                </span>
              ) : null}
            </div>

            {itemCount > 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {itemCount} {itemCount === 1 ? "item" : "items"} · {categories.length}{" "}
                {categories.length === 1 ? "category" : "categories"}
              </p>
            ) : null}

            {upiLink ? (
              <a
                href="#pay"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Scan &amp; pay
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {/* Category jump bar — a long mela menu on a phone is unusable without it. */}
      {categories.length > 1 ? (
        <nav
          aria-label="Menu categories"
          className="sticky top-0 z-20 border-b border-border/50 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
        >
          <ul className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
            {categories.map(([category], i) => (
              <li key={category} className="shrink-0">
                <a
                  href={`#${categoryAnchor(category, i)}`}
                  className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-border/70 px-3.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {category}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <main id="menu" className="mx-auto max-w-2xl px-4 py-7 sm:px-6 sm:py-9">
        <h2 className="sr-only">Menu</h2>

        {categories.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-background px-4 py-12 text-center text-sm text-muted-foreground">
            This stall has not published any items yet. Please check back soon.
          </p>
        ) : (
          <div className="space-y-8">
            {popular.length > 1 ? (
              <section aria-labelledby="popular-heading">
                <h3
                  id="popular-heading"
                  className="mb-3 flex items-center gap-2 font-display text-base font-bold text-awaaz-charcoal"
                >
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                  Most loved
                </h3>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {popular.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/10 to-background p-3 shadow-sm"
                    >
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 rounded-xl object-cover ring-1 ring-border/60"
                        />
                      ) : (
                        <span aria-hidden="true" className="text-2xl leading-none">
                          {item.emoji}
                        </span>
                      )}
                      <span className="text-sm font-semibold leading-snug text-foreground">
                        {item.name}
                      </span>
                      <span className="mt-auto font-mono text-sm font-bold tabular-nums text-primary">
                        {formatINRCompact(item.priceInPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {categories.map(([category, items], i) => (
              <section key={category} aria-labelledby={categoryAnchor(category, i)}>
                <div className="mb-3 flex scroll-mt-16 items-baseline gap-3">
                  <h3
                    id={categoryAnchor(category, i)}
                    className="font-display text-base font-bold text-awaaz-charcoal"
                  >
                    {category}
                  </h3>
                  <span className="h-px flex-1 bg-border/70" aria-hidden="true" />
                  <span className="text-xs font-semibold text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
                  {items.map((item) => (
                    <MenuRow key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {upiLink ? (
          <section
            id="pay"
            aria-labelledby="pay-heading"
            className="mt-10 scroll-mt-16 overflow-hidden rounded-2xl border border-primary/25 bg-background shadow-sm"
          >
            <div className="bg-gradient-to-b from-primary/10 to-transparent px-4 py-6 text-center sm:px-6">
              <h3 id="pay-heading" className="font-display text-xl font-bold text-awaaz-charcoal">
                Scan to pay
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Any UPI app. Enter the amount the vendor tells you.
              </p>

              <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3 shadow-md ring-1 ring-border/60">
                <Image
                  src={buildQrUrl(upiLink, 220)}
                  alt={`UPI QR code to pay ${payeeName}`}
                  width={220}
                  height={220}
                  unoptimized
                  className="rounded-lg"
                />
              </div>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Paying {payeeName}
              </p>
              {vendor.upiId ? (
                <div className="mt-2 flex justify-center">
                  <CopyUpiId upiId={vendor.upiId} className="max-w-full" />
                </div>
              ) : null}

              <a
                href={upiLink}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md sm:hidden"
              >
                Open UPI app
              </a>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="px-4 pb-10 pt-2 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span aria-hidden="true">🎙️</span>
          Billing by AwaazOS — Bol. Bill. Becho.
        </Link>
      </footer>
    </div>
  );
}
