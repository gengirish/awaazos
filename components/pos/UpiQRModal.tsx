"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import type { PaymentMethod } from "@prisma/client";
import { Check, ChevronDown, Copy, Maximize2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RadioOption } from "@/components/ui/radio-option";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ShowToCustomerQr } from "@/components/pos/ShowToCustomerQr";
import { cashTender, paiseToRupeesInput, parseRupeesInput, quickTenderPaise } from "@/lib/cash-tender";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { checkoutSale, saleRejectedMessage, saleUnsavedMessage } from "@/lib/pos-outbox";
import { paySheetShortcut } from "@/lib/pay-sheet-keys";
import { buildUpiUri } from "@/lib/upi";
import { useCartStore, type CartLine } from "@/lib/cartStore";
import { counterSaleSource } from "@/lib/pos-sale-source";
import { discountLabel } from "@/lib/offers";
import type { PayTotals } from "@/lib/pos-totals";
import { cn } from "@/lib/utils";

/** A sale that committed now, or one saved on the device to sync later. */
/** `clientRef` is what Undo reverts by (lib/pos-undo.ts). */
export type PaidResult =
  | { kind: "synced"; clientRef: string; billNumber: string; totalPaise: number; paymentMethod: PaymentMethod }
  | {
      kind: "queued";
      clientRef: string;
      localNo: number;
      totalPaise: number;
      paymentMethod: PaymentMethod;
      needsSignIn: boolean;
    };

export type UpiQRModalProps = {
  vendorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stallName: string;
  upiId: string | null;
  upiName: string | null;
  /** Captured when "Collect payment" was tapped (lib/pos-totals.ts). */
  totals: PayTotals;
  items: CartLine[];
  onPaid: (result: PaidResult) => void;
};

export function UpiQRModal({
  vendorId,
  open,
  onOpenChange,
  stallName,
  upiId,
  upiName,
  totals,
  items,
  onPaid,
}: UpiQRModalProps) {
  const { subtotalPaise, discountPaise, taxPaise, totalPaise } = totals;
  const effectiveUpiId = upiId?.trim() || "";
  // No UPI ID means no QR to show, so cash is the mode that can actually be paid.
  const defaultMode: "UPI" | "CASH" = effectiveUpiId ? "UPI" : "CASH";

  const [payMode, setPayMode] = useState<"UPI" | "CASH">(defaultMode);
  const [upiRef, setUpiRef] = useState("");
  const [showUpiRef, setShowUpiRef] = useState(false);
  const [received, setReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const markPaidRef = useRef<HTMLButtonElement>(null);
  const upiRefInputRef = useRef<HTMLInputElement>(null);
  // Focus the UTR field when the vendor opens it, not every time it remounts
  // (switching Cash → UPI with the U key must leave focus where it was).
  const focusUpiRefRef = useRef(false);
  // clientRef of a sale that could be neither committed nor saved on the
  // device. Reused while this sheet stays open, so a second tap replays the
  // same sale and can't bill twice if the first post did land.
  const unsavedRef = useRef<string | null>(null);
  const ids = useId();
  const upiRefFieldId = `${ids}-upi-ref-field`;
  const receivedHintId = `${ids}-received-hint`;

  useEffect(() => {
    if (!open) {
      setPayMode(defaultMode);
      setUpiRef("");
      setShowUpiRef(false);
      setReceived("");
      setSubmitting(false);
      setShowQr(false);
      unsavedRef.current = null;
    }
  }, [open, defaultMode]);

  useEffect(() => {
    if (showUpiRef && focusUpiRefRef.current) {
      focusUpiRefRef.current = false;
      upiRefInputRef.current?.focus();
    }
  }, [showUpiRef]);

  // What was handed over goes on the bill. Short (or unreadable) waits for the
  // rest of the cash; an empty field records nothing and doesn't block.
  const receivedPaise = parseRupeesInput(received);
  const tender = cashTender(totalPaise, receivedPaise);
  const receivedUnreadable = received.trim() !== "" && receivedPaise === null;
  const cashOk = tender.canMarkPaid && !receivedUnreadable;
  const tenders = quickTenderPaise(totalPaise);

  function focusPrimary(e: Event) {
    // Radix would focus the first focusable (the mode toggle); land on the
    // action the vendor most likely wants instead.
    if (markPaidRef.current && !markPaidRef.current.disabled) {
      e.preventDefault();
      markPaidRef.current.focus({ preventScroll: true });
    }
  }

  const effectiveName = (upiName?.trim() || stallName || "Merchant").slice(0, 80);
  const billRef = stallName.slice(0, 40) || "AwaazOS";

  // A fresh intent per amount, so the QR always asks for this bill's total.
  const upiLink =
    payMode === "UPI" && totalPaise > 0
      ? (buildUpiUri({ vpa: effectiveUpiId, payeeName: effectiveName, amountPaise: totalPaise, note: billRef }) ?? "")
      : "";
  // Rendered on the device, so the QR works offline and the VPA/amount never
  // go to a third-party image service.
  const qrSrc = useQrDataUrl(upiLink, 256);

  const markPaidDisabled =
    submitting || (payMode === "UPI" && !effectiveUpiId) || (payMode === "CASH" && !cashOk);

  async function copyUpiId() {
    try {
      await navigator.clipboard.writeText(effectiveUpiId);
      toast.success("UPI ID copied");
    } catch {
      toast.error("Couldn't copy. Select the UPI ID and copy it.");
    }
  }

  // Counter keyboards: U / C pick the mode, Enter marks paid (lib/pay-sheet-keys.ts).
  // Esc is the dialog's own. Keys inside the full-screen QR are left to it.
  function onSheetKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // A held Enter repeats faster than `submitting` re-renders: one press, one sale.
    if (showQr || e.defaultPrevented || e.repeat) return;
    const action = paySheetShortcut({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: e.nativeEvent.isComposing,
      target: e.target as HTMLElement,
    });
    if (!action) return;
    e.preventDefault();
    if (action === "upi") setPayMode("UPI");
    else if (action === "cash") setPayMode("CASH");
    else if (!markPaidDisabled) void markPaid();
  }

  async function markPaid() {
    setSubmitting(true);
    try {
      const paymentMethod: PaymentMethod = payMode === "CASH" ? "CASH" : "UPI";
      // Saved on the device first, then committed; offline it stays queued and
      // syncs later (lib/pos-outbox.ts). Either way the sale is not lost.
      const result = await checkoutSale(
        vendorId,
        {
          items: items.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            priceInPaise: i.priceInPaise,
            qty: i.qty,
          })),
          subtotalPaise,
          // Sent only with an offer, so a bill without one posts as it always did.
          ...(discountPaise > 0
            ? { discountPaise, offerId: totals.offerId, offerName: totals.offerName }
            : {}),
          taxPaise,
          totalPaise,
          paymentMethod,
          upiRef: payMode === "UPI" ? (upiRef.trim() || null) : null,
          ...(payMode === "CASH" && tender.kind === "change" ? { cashReceivedPaise: tender.receivedPaise } : {}),
          source: counterSaleSource(items, useCartStore.getState().voiceAddedIds),
        },
        { clientRef: unsavedRef.current ?? undefined },
      );
      if (result.kind === "rejected") {
        toast.error(saleRejectedMessage(result.code, result.status));
        return;
      }
      if (result.kind === "unsaved") {
        // Nothing holds this sale (device storage failed and the server did
        // not confirm it): keep the cart and this sheet, never show it as queued.
        unsavedRef.current = result.clientRef;
        toast.error(saleUnsavedMessage(result.reason));
        return;
      }
      onPaid(
        result.kind === "synced"
          ? {
              kind: "synced",
              clientRef: result.clientRef,
              billNumber: result.bill.billNumber,
              totalPaise: result.bill.totalPaise,
              paymentMethod: result.bill.paymentMethod,
            }
          : {
              kind: "queued",
              clientRef: result.clientRef,
              localNo: result.localNo,
              totalPaise,
              paymentMethod,
              needsSignIn: result.needsSignIn,
            },
      );
      onOpenChange(false);
    } catch (e) {
      // Never show (or log) a raw thrown message: only the error's class name.
      console.error("checkout_failed", e instanceof Error ? e.name : "unknown");
      toast.error("Could not record payment");
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount due</p>
        <p className="font-mono text-3xl font-bold tabular-nums text-foreground">{formatINR(totalPaise)}</p>
        {discountPaise > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {discountLabel(totals.offerName)}: −{formatINR(discountPaise)}
          </p>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Payment mode" className="grid grid-cols-2 gap-2">
        <RadioOption
          size="compact"
          name="pos-pay-mode"
          value="UPI"
          checked={payMode === "UPI"}
          onChange={() => setPayMode("UPI")}
          aria-keyshortcuts="U"
          label={
            <>
              UPI QR
              <ShortcutHint>U</ShortcutHint>
            </>
          }
        />
        <RadioOption
          size="compact"
          name="pos-pay-mode"
          value="CASH"
          checked={payMode === "CASH"}
          onChange={() => setPayMode("CASH")}
          aria-keyshortcuts="C"
          label={
            <>
              Cash
              <ShortcutHint>C</ShortcutHint>
            </>
          }
        />
      </div>

      {payMode === "UPI" ? (
        <>
          {!effectiveUpiId ? (
            // Not a call to action: leaving for Settings mid-sale loses the open bill.
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Take cash now — add a UPI ID in Settings later.
              </p>
              <Link
                href="/settings/payments"
                className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4"
              >
                Payment settings
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2">
                {qrSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local SVG data URL
                  <img
                    src={qrSrc}
                    alt="UPI payment QR code"
                    width={256}
                    height={256}
                    className="h-[200px] w-[200px] rounded-md border bg-white p-2 md:h-64 md:w-64"
                  />
                ) : (
                  <div className="h-[200px] w-[200px] rounded-md border bg-muted md:h-64 md:w-64" aria-hidden />
                )}
                <p className="text-center text-xs text-muted-foreground">Scan with GPay / PhonePe / Paytm</p>
                <p className="text-center text-sm text-foreground">
                  Paying <span className="font-semibold">{effectiveName}</span>
                </p>
                <div className="flex items-center justify-center gap-1">
                  <p className="break-all text-center font-mono text-sm text-muted-foreground">{effectiveUpiId}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    aria-label="Copy UPI ID"
                    onClick={() => void copyUpiId()}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={!qrSrc}
                  onClick={() => setShowQr(true)}
                >
                  <Maximize2 className="mr-2 h-4 w-4" aria-hidden />
                  Show to customer
                </Button>
              </div>
              {showUpiRef ? (
                <div className="space-y-2" id={upiRefFieldId}>
                  <Label htmlFor="upi-ref">Customer&apos;s UPI Reference (UTR)</Label>
                  <Input
                    ref={upiRefInputRef}
                    id="upi-ref"
                    name="upiRef"
                    value={upiRef}
                    onChange={(e) => setUpiRef(e.target.value)}
                    autoComplete="off"
                    placeholder="Optional"
                    className="font-mono"
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full text-muted-foreground"
                  onClick={() => {
                    focusUpiRefRef.current = true;
                    setShowUpiRef(true);
                  }}
                >
                  <ChevronDown className="mr-1 h-4 w-4" aria-hidden />
                  Add UPI reference (optional)
                </Button>
              )}
            </>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="cash-received">Received (₹)</Label>
            <Input
              id="cash-received"
              name="received"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Optional"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              aria-describedby={receivedHintId}
              className="h-12 font-mono text-lg tabular-nums"
            />
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Amount received">
            <Button
              type="button"
              variant={receivedPaise === totalPaise ? "default" : "outline"}
              className="h-11"
              aria-pressed={receivedPaise === totalPaise}
              onClick={() => setReceived(paiseToRupeesInput(totalPaise))}
            >
              Exact
            </Button>
            {tenders.map((p) => (
              <Button
                key={p}
                type="button"
                variant={receivedPaise === p ? "default" : "outline"}
                className="h-11 font-mono tabular-nums"
                aria-pressed={receivedPaise === p}
                onClick={() => setReceived(paiseToRupeesInput(p))}
              >
                {formatINRCompact(p)}
              </Button>
            ))}
          </div>
          <div id={receivedHintId} aria-live="polite" className="min-h-16">
            {tender.kind === "none" ? (
              <p className="text-center text-sm text-muted-foreground">
                {receivedUnreadable ? "Enter rupees, e.g. 100" : "Confirm once you have taken cash from the customer."}
              </p>
            ) : tender.kind === "change" ? (
              <p className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-center">
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Change to return
                </span>
                <span className="font-mono text-3xl font-bold tabular-nums text-foreground">
                  Return {formatINR(tender.changePaise)}
                </span>
              </p>
            ) : (
              <p className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-center">
                <span className="block font-mono text-2xl font-bold tabular-nums text-warning">
                  Short by {formatINR(tender.shortPaise)}
                </span>
                <span className="text-sm text-muted-foreground">Take the rest before marking paid.</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Bottom sheet on phones, centred dialog from md up (CSS breakpoint).
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent onOpenAutoFocus={focusPrimary} onKeyDown={onSheetKeyDown}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Collect payment</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Show the QR code or record cash received.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>{body}</ResponsiveDialogBody>
        {/* Pinned: the one primary action stays in reach however long the body is. */}
        <ResponsiveDialogFooter>
          <Button
            ref={markPaidRef}
            type="button"
            className="h-12 w-full"
            disabled={markPaidDisabled}
            aria-keyshortcuts="Enter"
            onClick={() => void markPaid()}
          >
            {submitting ? (
              "Saving…"
            ) : (
              <>
                Mark as paid
                <Check className="ml-1 h-5 w-5" aria-hidden />
                <ShortcutHint className="border-primary-foreground/40 text-primary-foreground/80">↵</ShortcutHint>
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
        <ShowToCustomerQr
          open={showQr}
          onOpenChange={setShowQr}
          qrSrc={qrSrc}
          totalPaise={totalPaise}
          payeeName={effectiveName}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Keyboard hint, counter screens only (md+). Hidden from the accessible name: aria-keyshortcuts carries it. */
function ShortcutHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "ml-2 hidden rounded border border-border px-1.5 font-mono text-[11px] font-normal leading-5 text-muted-foreground md:inline-block",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
