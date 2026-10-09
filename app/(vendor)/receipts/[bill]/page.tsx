import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ReceiptDocument } from "@/components/receipts/ReceiptDocument";
import { AutoPrint, ReceiptPrintToolbar } from "@/components/receipts/ReceiptPrintControls";
import { AuthError, requireVendorRole } from "@/lib/rbac";
import { parseReceiptPaper, RECEIPT_PAPER } from "@/lib/receipt";
import { loadVendorReceipt } from "@/lib/receipt-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Receipt · AwaazOS", robots: { index: false, follow: false } };

/**
 * Printable receipt for one bill, staff only. Paper width comes from
 * `?paper=` or VendorSettings.receiptPaper; the @page size per paper lives in
 * app/globals.css. `?autoprint=1` opens the print dialog on load; `?embed=1`
 * drops the toolbar and prints (the POS loads it in a hidden iframe).
 */
export default async function ReceiptPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ bill: string }>;
  searchParams: Promise<{ paper?: string; autoprint?: string; embed?: string }>;
}) {
  let vendorId: string;
  try {
    const ctx = await requireVendorRole("CASHIER");
    vendorId = ctx.vendor.id;
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }

  const [{ bill }, q] = await Promise.all([params, searchParams]);
  const receipt = await loadVendorReceipt(vendorId, { billNumber: bill });
  if (!receipt) notFound();

  const paper = parseReceiptPaper(q.paper, receipt.receiptPaper);
  const embed = q.embed === "1";

  return (
    <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
      {embed ? null : (
        <header className="print:hidden">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          >
            Skip to receipt
          </a>
          <ReceiptPrintToolbar billNumber={receipt.view.billNumber} paper={paper} receiptUrl={receipt.view.receiptUrl} />
        </header>
      )}
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "mx-auto box-content bg-white p-4 shadow-md focus:outline-hidden print:p-0 print:shadow-none",
          RECEIPT_PAPER[paper].sheetClass,
        )}
      >
        <ReceiptDocument view={receipt.view} compact={paper === "MM58"} />
      </main>
      {q.autoprint === "1" || embed ? <AutoPrint /> : null}
    </div>
  );
}
