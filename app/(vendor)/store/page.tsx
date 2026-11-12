import type { Metadata } from "next";

import { getShellContext } from "@/app/(vendor)/_shell-context";
import { StoreHubClient } from "@/components/store/StoreHubClient";
import { qrPngDataUrl, qrSvgDataUrl } from "@/lib/qr";
import { appBaseUrl } from "@/lib/storefront-razorpay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Your store" };

/**
 * "Your store", the raised Store tab: whether buyers can open the store, and
 * its link to open, share, copy or show as a QR. Every staff member may look
 * (the shell context requires CASHIER+ and finished setup); only an OWNER sees
 * Publish, and the API enforces that again. Reads only what the shell already
 * reads; the QR is drawn here, never by a third-party image host.
 */
export default async function StorePage() {
  const { vendor, role, storePath } = await getShellContext();
  const storeUrl = storePath ? `${appBaseUrl()}${storePath}` : null;
  const [qrSvg, qrPng] = storeUrl
    ? await Promise.all([qrSvgDataUrl(storeUrl, 240), qrPngDataUrl(storeUrl, 512)])
    : ["", ""];
  const slug = storePath ? decodeURIComponent(storePath.slice("/s/".length)) : "";

  return (
    <div className="bg-background p-4 pb-10 md:p-6">
      <header className="mx-auto mb-4 max-w-xl md:mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Your store</h1>
        <p className="truncate text-sm text-muted-foreground">{vendor.name}</p>
      </header>
      <main id="main" className="mx-auto max-w-xl">
        <StoreHubClient
          storeName={vendor.name}
          storePath={storePath}
          storeUrl={storeUrl}
          qrSvg={qrSvg}
          qrPng={qrPng}
          qrFileName={`store-qr-${slug}`}
          canPublish={role === "OWNER"}
        />
      </main>
    </div>
  );
}
