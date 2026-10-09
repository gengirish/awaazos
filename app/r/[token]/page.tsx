import type { Metadata } from "next";
import { Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ReceiptDocument } from "@/components/receipts/ReceiptDocument";
import { PrintButton } from "@/components/receipts/PrintButton";
import { loadPublicReceipt } from "@/lib/receipt-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Customer's receipt page, reached only through the 192-bit
 * `Receipt.publicToken` in the WhatsApp receipt. Public and unauthenticated.
 *
 * - Unknown token or inactive vendor → 404.
 * - The data comes from the `RECEIPT_TX_SELECT` allowlist (lib/receipt-data.ts):
 *   no customer phone, name, address or UTR, and no vendor phone or email.
 *   Whoever the customer forwards the link to sees exactly the paper receipt.
 * - Unlike /s/[slug] it does not depend on `publishStorefront`: the vendor
 *   chose to share this bill, not to publish a store. The "Order again" link
 *   still only appears when the storefront is published.
 * - Read-only, so no rate limit; the token is not guessable.
 */

const load = cache((token: string) => loadPublicReceipt(token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const view = await load(token);
  return {
    title: view ? `Receipt ${view.billNumber} · ${view.vendorName}` : "Receipt",
    robots: { index: false, follow: false },
    // The token is the whole credential: don't hand it to sites linked from here.
    referrer: "no-referrer",
  };
}

export default async function PublicReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await load(token);
  if (!view) notFound();

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 print:bg-white print:p-0">
      <main
        id="main"
        className="receipt-page-mm80 mx-auto w-full max-w-sm bg-white p-5 shadow-md print:w-[72mm] print:max-w-none print:p-0 print:shadow-none"
      >
        <ReceiptDocument view={view} />
      </main>
      <nav aria-label="Receipt actions" className="mx-auto mt-4 flex w-full max-w-sm flex-col gap-2 print:hidden">
        <PrintButton>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print or save as PDF
        </PrintButton>
        {view.storefrontUrl ? (
          <Link
            href={view.storefrontUrl}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Order again from {view.vendorName}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
