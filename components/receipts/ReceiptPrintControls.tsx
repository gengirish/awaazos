"use client";

import type { ReceiptPaper } from "@prisma/client";
import { ArrowLeft, Copy, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RECEIPT_PAPER } from "@/lib/receipt";
import { cn } from "@/lib/utils";

/** Opens the print dialog once, after the receipt has painted. */
export function AutoPrint() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // A frame's delay lets fonts and layout settle before the print snapshot.
    const id = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}

/** Screen-only bar above the receipt: back, paper width, copy link, print. */
export function ReceiptPrintToolbar({
  billNumber,
  paper,
  receiptUrl,
}: {
  billNumber: string;
  paper: ReceiptPaper;
  receiptUrl: string | null;
}) {
  async function copyLink() {
    if (!receiptUrl) return;
    try {
      await navigator.clipboard.writeText(receiptUrl);
      toast.success("Receipt link copied.");
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy it.");
    }
  }

  const papers = Object.keys(RECEIPT_PAPER) as ReceiptPaper[];

  return (
    <div className="receipt-toolbar mx-auto mb-4 flex w-full max-w-xl flex-wrap items-center gap-2 px-4">
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/transactions">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Bills
        </Link>
      </Button>
      <nav aria-label="Paper size" className="flex flex-wrap gap-1">
        {papers.map((p) => (
          <Link
            key={p}
            href={`/receipts/${encodeURIComponent(billNumber)}?paper=${p}`}
            replace
            aria-current={p === paper ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md border px-3 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              p === paper
                ? "border-foreground bg-foreground font-semibold text-background"
                : "border-input bg-background hover:bg-accent",
            )}
          >
            {RECEIPT_PAPER[p].label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex gap-2">
        {receiptUrl ? (
          <Button type="button" variant="outline" className="min-h-11" onClick={copyLink}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
        ) : null}
        <Button type="button" className="min-h-11" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print
        </Button>
      </div>
    </div>
  );
}
