import type { Metadata } from "next";

import { getShellContext } from "@/app/(vendor)/_shell-context";
import { StoreHubClient } from "@/components/store/StoreHubClient";
import { publicRatingText } from "@/lib/order-feedback";
import { loadRatingSummary } from "@/lib/order-feedback-server";
import { dropWillTakeOrdersWhere } from "@/lib/payment-guard";
import { prisma } from "@/lib/prisma";
import { qrPngDataUrl, qrSvgDataUrl } from "@/lib/qr";
import { storeLookRows, storeOrderingSummary } from "@/lib/store-hub";
import { storeThemeAttribute } from "@/lib/store-theme";
import { vocabularyForKind } from "@/lib/store-vocabulary";
import { appBaseUrl } from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Your store" };

/**
 * "Your store", the raised Store tab: a small copy of the store's header, whether
 * buyers can order and from what, the ways to bring buyers in, and (for the owner)
 * what is left to make the store look like theirs.
 *
 * Every staff member may look (the shell context requires CASHIER+ and finished
 * setup); only an OWNER sees Publish and the look rows, and the API enforces the
 * OWNER rule again. Read on page render only: open drops come from their times
 * (`storeOrderingSummary`), never a timer. The QR is drawn here, never by a
 * third-party image host.
 */
export default async function StorePage() {
  const { vendor, role, storePath, storeKind } = await getShellContext();
  const vocab = vocabularyForKind(storeKind);
  const now = new Date();

  const [row, itemCount, drops] = await Promise.all([
    prisma.vendor.findUnique({
      where: { id: vendor.id },
      select: {
        bannerUrl: true,
        logoUrl: true,
        isDemo: true,
        settings: { select: { theme: true, tagline: true, instagramHandle: true, acceptMenuOrders: true } },
      },
    }),
    // What a buyer sees on the store page: available and shown online.
    prisma.menuItem.count({ where: { vendorId: vendor.id, isAvailable: true, showOnline: true } }),
    prisma.drop.findMany({
      where: { vendorId: vendor.id, ...dropWillTakeOrdersWhere(now) },
      select: { title: true, status: true, opensAt: true, closesAt: true },
      orderBy: { closesAt: "asc" },
      take: 10,
    }),
  ]);
  const settings = row?.settings ?? null;
  // Same rule as the public store: no rating line on demo stores, nor below PUBLIC_RATING_MIN.
  const ratings = row && !row.isDemo ? await loadRatingSummary(vendor.id) : null;

  const storeUrl = storePath ? `${appBaseUrl()}${storePath}` : null;
  const [qrSvg, qrPng] = storeUrl
    ? await Promise.all([qrSvgDataUrl(storeUrl, 240), qrPngDataUrl(storeUrl, 512)])
    : ["", ""];
  const slug = storePath ? decodeURIComponent(storePath.slice("/s/".length)) : "";

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-4 max-w-xl md:mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Your store</h1>
      </header>
      <main id="main" className="mx-auto max-w-xl">
        <StoreHubClient
          storeName={vendor.name}
          storePath={storePath}
          storeUrl={storeUrl}
          qrSvg={qrSvg}
          qrPng={qrPng}
          qrFileName={`store-qr-${slug}`}
          isOwner={role === "OWNER"}
          canOpenDrop={role !== "CASHIER"}
          preview={{
            bannerUrl: row?.bannerUrl ?? null,
            logoUrl: row?.logoUrl ?? null,
            theme: storeThemeAttribute(settings?.theme) ?? null,
            tagline: settings?.tagline ?? null,
          }}
          itemCount={itemCount}
          itemWord={itemCount === 1 ? vocab.item : vocab.items}
          ratingText={ratings ? publicRatingText(ratings) : null}
          ordering={storeOrderingSummary({ acceptMenuOrders: settings?.acceptMenuOrders ?? false, drops }, vocab, now)}
          catalogueOrdersTitle={vocab.catalogueOrdersTitle}
          look={storeLookRows({
            bannerUrl: row?.bannerUrl ?? null,
            logoUrl: row?.logoUrl ?? null,
            theme: settings?.theme,
            tagline: settings?.tagline ?? null,
            instagramHandle: settings?.instagramHandle ?? null,
          })}
        />
      </main>
    </div>
  );
}
