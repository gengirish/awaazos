"use client";

import type { ReceiptPaper } from "@prisma/client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ReceiptDocument } from "@/components/receipts/ReceiptDocument";
import {
  DEFAULT_RECEIPT_FOOTER,
  GSTIN_FORMAT_MESSAGE,
  GSTIN_PATTERN,
  RECEIPT_FOOTER_MAX,
  RECEIPT_PAPER,
  type ReceiptView,
} from "@/lib/receipt";
import { cn } from "@/lib/utils";

export type ReceiptSettingsValues = {
  receiptFooter: string;
  gstin: string;
  autoPrintReceipt: boolean;
  receiptPaper: ReceiptPaper;
};

export type ReceiptSettingsClientProps = {
  initial: ReceiptSettingsValues;
  vendorName: string;
  vendorLocation: string | null;
  fssaiNumber: string | null;
  isOwner: boolean;
};

const PAPERS = Object.keys(RECEIPT_PAPER) as ReceiptPaper[];

/** Sample bill for the live preview. Amounts are paise. */
const SAMPLE_ITEMS = [
  { name: "Masala Chai", qty: 2, priceInPaise: 2000 },
  { name: "Samosa", qty: 3, priceInPaise: 1500 },
];

export function ReceiptSettingsClient({
  initial,
  vendorName,
  vendorLocation,
  fssaiNumber,
  isOwner,
}: ReceiptSettingsClientProps) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [gstinError, setGstinError] = useState<string | null>(null);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    values.receiptFooter.trim() !== saved.receiptFooter ||
    values.gstin.trim() !== saved.gstin ||
    values.autoPrintReceipt !== saved.autoPrintReceipt ||
    values.receiptPaper !== saved.receiptPaper;

  const preview = useMemo<ReceiptView>(() => {
    const subtotalPaise = SAMPLE_ITEMS.reduce((s, i) => s + i.priceInPaise * i.qty, 0);
    const gstin = values.gstin.trim().toUpperCase();
    return {
      vendorName,
      vendorLocation,
      gstin: GSTIN_PATTERN.test(gstin) ? gstin : null,
      fssaiNumber,
      billNumber: "AWZ-20261009-0042",
      createdAt: "2026-10-09T12:30:00.000Z",
      items: SAMPLE_ITEMS,
      subtotalPaise,
      discountPaise: 0,
      deliveryFeePaise: 0,
      taxPaise: 0,
      totalPaise: subtotalPaise,
      paymentMethod: "UPI",
      paymentStatus: "PAID",
      cancelled: false,
      receiptFooter: values.receiptFooter,
      storefrontUrl: null,
      receiptUrl: null,
    };
  }, [values.gstin, values.receiptFooter, vendorName, vendorLocation, fssaiNumber]);

  function save() {
    const gstin = values.gstin.trim().toUpperCase();
    const receiptFooter = values.receiptFooter.trim();
    if (gstin && !GSTIN_PATTERN.test(gstin)) {
      setGstinError(GSTIN_FORMAT_MESSAGE);
      return;
    }
    setGstinError(null);
    setFooterError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            receiptFooter,
            gstin,
            autoPrintReceipt: values.autoPrintReceipt,
            receiptPaper: values.receiptPaper,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: Record<string, string[] | undefined>;
          };
          const g = data.details?.gstin?.[0];
          const f = data.details?.receiptFooter?.[0];
          if (g) setGstinError(g);
          if (f) setFooterError(f);
          toast.error(g ?? f ?? data.error ?? "Could not save.");
          return;
        }
        const next = { ...values, gstin, receiptFooter };
        setValues(next);
        setSaved(next);
        toast.success("Receipt settings saved.");
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  const inputClass =
    "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
      <div className="space-y-6">
        {!isOwner && <p className="text-sm text-muted-foreground">Only the owner can change these.</p>}

        <div className="space-y-2">
          <label htmlFor="receipt-footer" className="text-sm font-medium">
            Message at the bottom
          </label>
          <textarea
            id="receipt-footer"
            rows={2}
            maxLength={RECEIPT_FOOTER_MAX}
            value={values.receiptFooter}
            placeholder={DEFAULT_RECEIPT_FOOTER}
            disabled={!isOwner}
            onChange={(e) => {
              setValues((v) => ({ ...v, receiptFooter: e.target.value }));
              setFooterError(null);
            }}
            aria-invalid={footerError ? true : undefined}
            aria-describedby="receipt-footer-hint"
            className={cn(inputClass, "py-2")}
          />
          <p
            id="receipt-footer-hint"
            className={cn("text-xs", footerError ? "text-destructive" : "text-muted-foreground")}
          >
            {footerError ??
              `Up to ${RECEIPT_FOOTER_MAX} characters. Left blank, receipts say “${DEFAULT_RECEIPT_FOOTER}”`}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="receipt-gstin" className="text-sm font-medium">
            GSTIN <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="receipt-gstin"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={15}
            value={values.gstin}
            disabled={!isOwner}
            onChange={(e) => {
              setValues((v) => ({ ...v, gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") }));
              setGstinError(null);
            }}
            aria-invalid={gstinError ? true : undefined}
            aria-describedby="receipt-gstin-hint"
            className={cn(inputClass, "font-mono uppercase tabular-nums")}
          />
          <p id="receipt-gstin-hint" className={cn("text-xs", gstinError ? "text-destructive" : "text-muted-foreground")}>
            {gstinError ?? "15 characters. Printed at the top of every receipt once you're GST-registered."}
          </p>
        </div>

        <fieldset className="space-y-2" disabled={!isOwner}>
          <legend className="text-sm font-medium">Printer paper</legend>
          <div className="flex flex-wrap gap-2">
            {PAPERS.map((p) => (
              <label
                key={p}
                className={cn(
                  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-50",
                  values.receiptPaper === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="receipt-paper"
                  value={p}
                  checked={values.receiptPaper === p}
                  onChange={() => setValues((v) => ({ ...v, receiptPaper: p }))}
                  className="sr-only"
                />
                {RECEIPT_PAPER[p].label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Most Bluetooth bill printers use 58 mm or 80 mm rolls. You can still switch size on the print page.
          </p>
        </fieldset>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label htmlFor="receipt-autoprint" className="text-sm font-medium">
              Print every bill automatically
            </label>
            <p className="text-xs text-muted-foreground">
              On a counter computer, the print dialog opens as soon as a sale is paid. On phones, tap
              &ldquo;Print receipt&rdquo; after the sale.
            </p>
          </div>
          <button
            id="receipt-autoprint"
            type="button"
            role="switch"
            aria-checked={values.autoPrintReceipt}
            onClick={() => setValues((v) => ({ ...v, autoPrintReceipt: !v.autoPrintReceipt }))}
            disabled={!isOwner}
            className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="sr-only">{values.autoPrintReceipt ? "Auto-print on" : "Auto-print off"}</span>
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
                values.autoPrintReceipt ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
                  values.autoPrintReceipt ? "translate-x-6" : "translate-x-1",
                )}
              />
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={!isOwner || !dirty || pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>

      <figure className="space-y-2">
        <figcaption className="text-sm font-medium">Preview</figcaption>
        <div className="mx-auto w-[72mm] max-w-full rounded-md border bg-white p-4 shadow-xs">
          <ReceiptDocument view={preview} headingLevel={3} compact={values.receiptPaper === "MM58"} />
        </div>
      </figure>
    </div>
  );
}
