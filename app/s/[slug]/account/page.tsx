import type { Metadata } from "next";
import { ArrowLeft, ChevronRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { CustomerProfile, CustomerSignOut } from "@/components/storefront/CustomerProfile";
import { CustomerSignIn } from "@/components/storefront/CustomerSignIn";
import { formatINR } from "@/lib/currency";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { orderDisplayState } from "@/lib/drops";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { prisma } from "@/lib/prisma";
import { orderStatusLabel, type StatusTone } from "@/lib/storefront-order";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Storefront buyer account — sign in, edit details, "My orders at <kitchen>".
 *
 * Same gate as app/s/[slug]/page.tsx: vendor active + publishStorefront, else
 * 404. The vendor `select` is a hand-written allowlist — `Vendor.phone` and
 * `Vendor.email` must never appear here.
 *
 * Orders are listed ONLY by `customerId` (set when the order was placed while
 * signed in) AND this vendor AND source STOREFRONT. Never by phone match: the
 * phone on an order is unverified, so matching on it would show one person
 * another person's orders. UTR is read only to derive the status label.
 */

const BRAND_THEMES = new Set(["green", "amber", "red", "blue", "purple"]);

const loadVendor = cache(async (slug: string) =>
  prisma.vendor.findFirst({
    where: { slug, isActive: true, settings: { is: { publishStorefront: true } } },
    select: { id: true, slug: true, name: true, settings: { select: { theme: true } } },
  }),
);

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const vendor = await loadVendor(params.slug);
  return {
    title: vendor ? `Your account — ${vendor.name}` : "Not found — AwaazOS",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-green-600/30 bg-green-600/10 text-green-800",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-900",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-foreground",
};

export default async function StorefrontAccountPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ login?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const vendor = await loadVendor(params.slug);
  if (!vendor) notFound();

  const customer = await getCurrentCustomer();
  const rawTheme = vendor.settings?.theme ?? "orange";
  const theme = BRAND_THEMES.has(rawTheme) ? rawTheme : undefined;
  const accountPath = `/s/${vendor.slug}/account`;

  const orders = customer
    ? await prisma.transaction.findMany({
        where: {
          customerId: customer.id,
          vendorId: vendor.id,
          source: "STOREFRONT",
          orderToken: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderToken: true,
          billNumber: true,
          createdAt: true,
          totalPaise: true,
          paymentMethod: true,
          paymentStatus: true,
          upiRef: true,
          fulfilmentStatus: true,
          drop: { select: { title: true } },
        },
      })
    : [];

  const now = new Date();

  return (
    <div data-theme={theme} className="min-h-screen bg-awaaz-cream/40">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="border-b border-border/50 bg-linear-to-b from-primary/15 to-background">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
          <Link
            href={`/s/${vendor.slug}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {vendor.name}
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl space-y-8 px-4 py-7 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-awaaz-charcoal">
          {customer ? `Hi${customer.name ? `, ${customer.name}` : ""}` : `Sign in to ${vendor.name}`}
        </h1>

        {!customer ? (
          <section aria-labelledby="signin-heading" className="rounded-2xl border border-border/60 bg-background p-5 shadow-xs">
            <h2 id="signin-heading" className="sr-only">
              Sign in
            </h2>
            {searchParams.login === "expired" ? (
              <p role="alert" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
                That sign-in link has expired or was already used. Enter your email for a new one.
              </p>
            ) : null}
            <p className="mb-4 text-sm text-muted-foreground">
              Optional — you can always order as a guest. Signing in fills in your details at checkout and
              keeps your orders here.
            </p>
            <CustomerSignIn returnTo={accountPath} kitchenName={vendor.name} />
          </section>
        ) : (
          <>
            <section aria-labelledby="orders-heading">
              <h2 id="orders-heading" className="mb-3 font-display text-lg font-bold text-awaaz-charcoal">
                My orders at {vendor.name}
              </h2>
              {orders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                  No orders yet. Orders you place while signed in show up here.
                </p>
              ) : (
                <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xs">
                  {orders.map((o) => {
                    const state = orderDisplayState(
                      {
                        fulfilmentStatus: o.fulfilmentStatus,
                        paymentStatus: o.paymentStatus,
                        paymentMethod: o.paymentMethod,
                        upiRef: o.upiRef,
                        createdAt: o.createdAt,
                      },
                      now,
                    );
                    const status = orderStatusLabel(state, o.fulfilmentStatus);
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/s/${vendor.slug}/o/${encodeURIComponent(o.orderToken ?? "")}`}
                          className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-primary/4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        >
                          <ShoppingBag className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {o.drop?.title ?? "Order"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {formatIstDate(o.createdAt)} · {formatIstTime(o.createdAt)} ·{" "}
                              <span className="font-mono">{o.billNumber}</span>
                            </span>
                            <span
                              className={cn(
                                "mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                                TONE_CLASS[status.tone],
                              )}
                            >
                              {status.label}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-sm font-bold tabular-nums">
                            {formatINR(o.totalPaise)}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="details-heading" className="rounded-2xl border border-border/60 bg-background p-5 shadow-xs">
              <h2 id="details-heading" className="mb-3 font-display text-lg font-bold text-awaaz-charcoal">
                Your details
              </h2>
              <CustomerProfile
                email={customer.email}
                name={customer.name}
                phone={customer.phone}
                savedAddress={customer.savedAddress}
              />
            </section>

            <div className="flex justify-center">
              <CustomerSignOut />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
