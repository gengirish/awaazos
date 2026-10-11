"use client";

import { useCallback, useEffect, useState } from "react";
import { PaymentMethod, type StaffRole } from "@prisma/client";

import { PosHeader } from "@/components/pos/PosHeader";
import { PosNav } from "@/components/pos/PosNav";
import { PosSyncStatus } from "@/components/pos/PosSyncStatus";
import { QuickAddGrid, type MenuTile } from "@/components/pos/QuickAddGrid";
import { OrderCart, type PosSettings } from "@/components/pos/OrderCart";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import { POS_CART_ANCHOR_ID, StickyCheckoutBar } from "@/components/pos/StickyCheckoutBar";
import { UpiQRModal, type PaidResult } from "@/components/pos/UpiQRModal";
import { VoiceOrderButton } from "@/components/pos/VoiceOrderButton";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useOnline } from "@/hooks/useOnline";
import { usePosOutbox } from "@/hooks/usePosOutbox";
import { useCartStore } from "@/lib/cartStore";
import { registerAppServiceWorker } from "@/lib/sw-client";

export type PosShellProps = {
  vendor: {
    id: string;
    name: string;
    slug: string;
    upiId: string | null;
    upiName: string | null;
    /** `VendorSettings.publishStorefront` — the store link is shown only when true. */
    storefrontPublished: boolean;
  };
  initialItems: MenuTile[];
  settings: PosSettings & { voiceLang: string; autoPrintReceipt: boolean };
  todaysRevenuePaise: number;
  /** ISO time the server rendered this page; shown as "menu as of" when offline. */
  renderedAt: string;
  /** Role of the signed-in staff member at this vendor; trims the nav for cashiers. */
  staffRole: StaffRole;
};

export function PosShell({
  vendor,
  initialItems,
  settings,
  todaysRevenuePaise,
  renderedAt,
  staffRole,
}: PosShellProps) {
  const items = useCartStore((s) => s.items);
  const online = useOnline();
  const outbox = usePosOutbox(vendor.id);

  const isDesktop = useIsDesktop();
  const [payOpen, setPayOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [payTotals, setPayTotals] = useState({
    subtotalPaise: 0,
    taxPaise: 0,
    totalPaise: 0,
  });
  const [receiptMeta, setReceiptMeta] = useState({
    billNumber: "",
    totalPaise: 0,
    paymentMethod: PaymentMethod.UPI as PaymentMethod,
    queued: null as { localNo: number; needsSignIn: boolean } | null,
  });

  // Lets /pos open from the Home Screen with no network (public/sw.js).
  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  const onCollectPayment = useCallback(
    (totals: { subtotalPaise: number; taxPaise: number; totalPaise: number }) => {
      setPayTotals(totals);
      setPayOpen(true);
    },
    [],
  );

  const onPaid = useCallback((result: PaidResult) => {
    // The sale is saved (synced or queued in the outbox) — empty the cart now,
    // so dismissing the receipt by swipe/Esc can never leave paid items behind.
    // UpiQRModal has already captured the lines it posted.
    useCartStore.getState().clearCart();
    setReceiptMeta(
      result.kind === "synced"
        ? {
            billNumber: result.billNumber,
            totalPaise: result.totalPaise,
            paymentMethod: result.paymentMethod,
            queued: null,
          }
        : {
            billNumber: "",
            totalPaise: result.totalPaise,
            paymentMethod: result.paymentMethod,
            queued: { localNo: result.localNo, needsSignIn: result.needsSignIn },
          },
    );
    setReceiptOpen(true);
  }, []);

  const cartSettings: PosSettings = {
    taxEnabled: settings.taxEnabled,
    taxPercent: settings.taxPercent,
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 md:max-w-6xl md:pb-10 md:pt-6">
      <a
        href="#main-pos"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <PosNav staffRole={staffRole} />
      <PosHeader
        stallName={vendor.name}
        todaysRevenuePaise={todaysRevenuePaise}
        pendingPaise={outbox.pendingTodayPaise}
        storePath={vendor.storefrontPublished ? `/s/${encodeURIComponent(vendor.slug)}` : null}
        vendorId={vendor.id}
      />
      <PosSyncStatus
        online={online}
        renderedAt={renderedAt}
        pending={outbox.pending}
        failed={outbox.failed}
        needsSignIn={outbox.needsSignIn}
        onSync={outbox.sync}
        onDiscard={(ref) => void outbox.discard(ref)}
      />
      <main
        id="main-pos"
        className="mt-6 flex flex-col gap-8 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-start md:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
      >
        <div className="flex min-w-0 flex-col gap-8">
          <VoiceOrderButton voiceLang={settings.voiceLang} />
          <QuickAddGrid items={initialItems} />
        </div>
        <div
          id={POS_CART_ANCHOR_ID}
          tabIndex={-1}
          className="min-w-0 scroll-mt-4 focus:outline-hidden md:sticky md:top-6 md:max-h-[calc(100dvh-3rem)] md:overflow-y-auto"
        >
          <OrderCart settings={cartSettings} onCollectPayment={onCollectPayment} />
        </div>
      </main>

      <StickyCheckoutBar settings={cartSettings} onCollectPayment={onCollectPayment} />

      <UpiQRModal
        vendorId={vendor.id}
        open={payOpen}
        onOpenChange={setPayOpen}
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
        queued={receiptMeta.queued}
        autoPrint={settings.autoPrintReceipt}
        onCloseAll={() => {
          setPayOpen(false);
          setReceiptOpen(false);
        }}
      />
    </div>
  );
}
