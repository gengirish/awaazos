"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PaymentMethod } from "@prisma/client";

import { PosHeader } from "@/components/pos/PosHeader";
import { QuickAddGrid, type MenuTile } from "@/components/pos/QuickAddGrid";
import { OrderCart, type PosSettings } from "@/components/pos/OrderCart";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import { UpiQRModal } from "@/components/pos/UpiQRModal";
import { VoiceOrderButton } from "@/components/pos/VoiceOrderButton";
import { useCartStore } from "@/lib/cartStore";

export type PosShellProps = {
  vendor: {
    id: string;
    name: string;
    slug: string;
    upiId: string | null;
    upiName: string | null;
  };
  initialItems: MenuTile[];
  settings: PosSettings & { voiceLang: string };
  todaysRevenuePaise: number;
};

export function PosShell({ vendor, initialItems, settings, todaysRevenuePaise }: PosShellProps) {
  const items = useCartStore((s) => s.items);

  const [isDesktop, setIsDesktop] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [voiceDoubleCheck, setVoiceDoubleCheck] = useState(false);
  const [payTotals, setPayTotals] = useState({
    subtotalPaise: 0,
    taxPaise: 0,
    totalPaise: 0,
  });
  const [receiptMeta, setReceiptMeta] = useState({
    billNumber: "",
    totalPaise: 0,
    paymentMethod: PaymentMethod.UPI as PaymentMethod,
  });

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const onCollectPayment = useCallback(
    (totals: { subtotalPaise: number; taxPaise: number; totalPaise: number }) => {
      setPayTotals(totals);
      setPayOpen(true);
    },
    [],
  );

  const onPaid = useCallback(
    (result: { billNumber: string; totalPaise: number; paymentMethod: PaymentMethod }) => {
      setReceiptMeta(result);
      setReceiptOpen(true);
    },
    [],
  );

  const cartSettings: PosSettings = {
    taxEnabled: settings.taxEnabled,
    taxPercent: settings.taxPercent,
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-4 md:max-w-4xl md:pb-10 md:pt-6">
      <a
        href="#main-pos"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <nav
        className="mb-4 flex items-center justify-between gap-2"
        aria-label="POS navigation"
      >
        <Link
          href="/menu"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Menu
        </Link>
        <Link
          href="/drops"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Drops
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/transactions"
            className="hidden min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex"
          >
            Transactions
          </Link>
          <Link
            href="/analytics"
            className="hidden min-h-11 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex"
          >
            Analytics
          </Link>
        </div>
      </nav>
      <PosHeader stallName={vendor.name} todaysRevenuePaise={todaysRevenuePaise} />
      <main id="main-pos" className="mt-6 flex flex-col gap-8">
        <VoiceOrderButton voiceLang={settings.voiceLang} onNeedsConfirmationChange={setVoiceDoubleCheck} />
        <QuickAddGrid items={initialItems} />
        {voiceDoubleCheck ? (
          <div
            role="status"
            className="rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          >
            Double-check this order — voice confidence is low.
          </div>
        ) : null}
        <OrderCart settings={cartSettings} onCollectPayment={onCollectPayment} />
      </main>

      <UpiQRModal
        open={payOpen}
        onOpenChange={setPayOpen}
        isDesktop={isDesktop}
        stallName={vendor.name}
        upiId={vendor.upiId}
        upiName={vendor.upiName}
        totalPaise={payTotals.totalPaise}
        subtotalPaise={payTotals.subtotalPaise}
        taxPaise={payTotals.taxPaise}
        items={items}
        onPaid={onPaid}
      />

      <ReceiptModal
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        isDesktop={isDesktop}
        billNumber={receiptMeta.billNumber}
        totalPaise={receiptMeta.totalPaise}
        paymentMethod={receiptMeta.paymentMethod}
        onCloseAll={() => {
          setPayOpen(false);
          setReceiptOpen(false);
        }}
      />
    </div>
  );
}
