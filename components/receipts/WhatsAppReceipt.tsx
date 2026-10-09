"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { receiptPrintPath } from "@/lib/receipt";

type ReceiptRef = { billNumber?: string; transactionId?: string };

/**
 * Fetches a bill's receipt text while `active`. Fetched ahead of the tap so the
 * WhatsApp button can be a plain link — opening wa.me after an `await` inside a
 * click handler gets popup-blocked on mobile.
 *
 * `undefined` = loading, `null` = failed, string = ready.
 */
export function useReceiptText(active: boolean, ref: ReceiptRef): string | null | undefined {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const { billNumber, transactionId } = ref;

  useEffect(() => {
    if (!active || !(billNumber || transactionId)) {
      setText(undefined);
      return;
    }
    const params = new URLSearchParams(transactionId ? { transactionId } : { billNumber: billNumber! });
    const controller = new AbortController();
    setText(undefined);
    fetch(`/api/receipts/message?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: { text?: string } };
        setText(json.data?.text ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setText(null);
      });
    return () => controller.abort();
  }, [active, billNumber, transactionId]);

  return text;
}

export function WhatsAppReceiptButton({
  url,
  loading,
  label = "Send on WhatsApp",
  className = "h-12 w-full",
}: {
  url: string | null;
  loading: boolean;
  label?: string;
  className?: string;
}) {
  if (!url) {
    return (
      <Button type="button" variant="secondary" className={className} disabled>
        {loading ? "Preparing receipt…" : label}
      </Button>
    );
  }
  return (
    <Button asChild variant="secondary" className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}

/** Opens the bill's print page in a new tab with the print dialog up. A plain link, so it never gets popup-blocked. */
export function PrintReceiptLink({ billNumber, className = "h-12 w-full" }: { billNumber: string; className?: string }) {
  return (
    <Button asChild variant="outline" className={className}>
      <a href={receiptPrintPath(billNumber, { autoprint: true })} target="_blank" rel="noopener">
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print receipt
      </a>
    </Button>
  );
}

/**
 * VendorSettings.autoPrintReceipt: while `billNumber` is set, loads the print
 * page in a hidden iframe, which opens the print dialog for itself. An iframe
 * needs no user gesture, unlike a new tab after the sale's `await`.
 */
export function useAutoPrintReceipt(billNumber: string | null) {
  useEffect(() => {
    if (!billNumber) return;
    const frame = document.createElement("iframe");
    frame.src = receiptPrintPath(billNumber, { embed: true });
    frame.title = "Receipt for printing";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.className = "pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0";
    document.body.appendChild(frame);
    return () => frame.remove();
  }, [billNumber]);
}
