import type { Metadata } from "next";
import { CalendarClock, ChevronRight, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ShareStoreButton } from "@/components/storefront/ShareStoreButton";
import { EmptyState } from "@/components/ui/empty-state";
import type { CommunityStoreOrdering } from "@/lib/community";
import { loadCommunityPage, type CommunityPageStore } from "@/lib/community-server";
import { stallTypeLabel } from "@/lib/stall-type";
import { formatIstDeadline } from "@/lib/storefront-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public community page — one per housing society ("SDG Home Kitchens"),
 * listing links to the stores of home kitchens that live there. Rules in
 * lib/community.ts; the query is `loadCommunityPage` (lib/community-server.ts).
 *
 * A directory, not a marketplace: each card links to the store's own
 * `/s/<slug>`, where ordering happens. Stores appear only after their OWNER
 * accepts, and only while their own store page is published. Which store is
 * taking pre-orders is worked out on this render (no timers), so the page is
 * force-dynamic.
 *
 * `noindex`: the page names a residential society and the home businesses in
 * it. It is meant to be shared in the society's WhatsApp groups, not found by
 * search.
 *
 * No loading.tsx here (as under app/s): it would stream the page and turn
 * notFound() into a 200.
 */

const loadPage = cache((slug: string) => loadCommunityPage(slug));

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const page = await loadPage(slug);
  if (!page) return { title: "Not found — AwaazOS" };
  const where = page.area ? ` in ${page.area}` : "";
  const description = `Home kitchens${where}. Order ahead from your neighbours and pay by UPI.`;
  return {
    title: `${page.name} — Home kitchens`,
    description,
    openGraph: { title: page.name, description, type: "website" },
    robots: { index: false, follow: false },
  };
}

function OrderingLine({ ordering, now }: { ordering: CommunityStoreOrdering; now: Date }) {
  switch (ordering.kind) {
    case "drop_open":
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {ordering.title} · order by {formatIstDeadline(ordering.closesAt, now)}
          </span>
        </span>
      );
    case "drop_scheduled":
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-primary">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {ordering.title} · orders open {formatIstDeadline(ordering.opensAt, now)}
          </span>
        </span>
      );
    case "menu":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          Order from the menu
        </span>
      );
    case "browse":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <UtensilsCrossed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          See the menu
        </span>
      );
  }
}

function StoreCard({ store, now }: { store: CommunityPageStore; now: Date }) {
  const kind = stallTypeLabel(store.stallType, store.stallTypeOther);
  return (
    <li>
      <Link
        href={`/s/${encodeURIComponent(store.slug)}`}
        className="flex min-h-11 items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-primary/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:gap-4 sm:p-4"
      >
        {store.logoUrl ? (
          <Image
            src={store.logoUrl}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border/60"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Store className="h-6 w-6" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-semibold text-foreground">{store.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {store.city ? `${kind} · ${store.city}` : kind}
          </span>
          <OrderingLine ordering={store.ordering} now={now} />
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

export default async function CommunityPageRoute(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const page = await loadPage(slug);
  if (!page) notFound();

  const now = new Date();
  const openNow = page.stores.filter((s) => s.ordering.kind === "drop_open").length;

  return (
    <div className="min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to stores
      </a>
      <header className="bg-linear-to-b from-primary/10 to-background px-4 pb-6 pt-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Home kitchens near you</p>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight text-awaaz-charcoal">{page.name}</h1>
          {page.area ? <p className="mt-1 text-sm text-muted-foreground">{page.area}</p> : null}
          {page.description ? <p className="mt-3 text-sm text-foreground">{page.description}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ShareStoreButton
              vendorName={page.name}
              slug={page.slug}
              path={`/c/${encodeURIComponent(page.slug)}`}
              text={`Home kitchens at ${page.name}`}
            />
            <p className="text-sm text-muted-foreground">
              {page.stores.length} {page.stores.length === 1 ? "store" : "stores"}
              {openNow > 0 ? ` · ${openNow} taking pre-orders now` : ""}
            </p>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-4 pb-12">
        <h2 className="sr-only">Stores</h2>
        {page.stores.length === 0 ? (
          <EmptyState
            icon={Store}
            title="No stores listed yet"
            description="Stores appear here once the home kitchens in this community join."
          />
        ) : (
          <ul className="space-y-3">
            {page.stores.map((store) => (
              <StoreCard key={store.slug} store={store} now={now} />
            ))}
          </ul>
        )}
      </main>

      <footer className="mx-auto max-w-2xl px-4 pb-10 text-center text-sm text-muted-foreground">
        <p>
          Run a home kitchen here?{" "}
          <Link
            href="/sign-up"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            Start your own store
          </Link>
        </p>
        <p className="text-xs">Each store takes its own orders and payments.</p>
      </footer>
    </div>
  );
}
