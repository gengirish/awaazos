"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

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
