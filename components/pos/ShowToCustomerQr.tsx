"use client";

import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { formatINR } from "@/lib/currency";

export type ShowToCustomerQrProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Local SVG data URL from useQrDataUrl. */
  qrSrc: string;
  totalPaise: number;
  payeeName: string;
};

/**
 * Keeps the screen on while the customer scans. Feature-detected and silent:
 * no Wake Lock (Firefox, older Safari, an insecure origin) just means the
 * phone may dim as usual. The browser drops the lock when the tab is hidden,
 * so it is asked for again on return.
 */
function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => undefined);
        else lock = next;
      } catch {
        // Battery saver, permissions policy, hidden tab: carry on without it.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/**
 * The bill's QR, as big as the screen allows, for the customer to scan off the
 * vendor's phone. A nested Radix dialog over "Collect payment": it traps focus
 * itself, Esc closes only this layer, and the payment sheet underneath keeps
 * its state. White on purpose (not a theme token) so scanners get full
 * contrast in dark mode too.
 */
export function ShowToCustomerQr({ open, onOpenChange, qrSrc, totalPaise, payeeName }: ShowToCustomerQrProps) {
  const qrRef = useRef<HTMLDivElement>(null);
  useScreenWakeLock(open);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // A tap anywhere but the QR closes, so a mis-tap on the code never does.
          onClick={(e) => {
            if (!qrRef.current?.contains(e.target as Node)) onOpenChange(false);
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-white px-4 py-[max(1rem,env(safe-area-inset-top))] text-neutral-950 focus:outline-hidden motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0"
        >
          {/* The dialog's accessible name (Radix labels the content by its Title). */}
          <DialogPrimitive.Title className="sr-only">
            UPI QR code to pay {formatINR(totalPaise)} to {payeeName}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] flex size-12 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-6 w-6" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <p className="font-mono text-5xl font-bold tabular-nums md:text-6xl">{formatINR(totalPaise)}</p>
          <div ref={qrRef}>
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- local SVG data URL
              <img src={qrSrc} alt="" width={512} height={512} className="size-[70vmin] max-h-[60dvh] max-w-[60dvh]" />
            ) : (
              <div className="size-[70vmin] max-h-[60dvh] max-w-[60dvh] bg-neutral-100" aria-hidden />
            )}
          </div>
          <p className="text-center text-xl">
            Paying <span className="font-semibold">{payeeName}</span>
          </p>
          <p className="text-center text-base text-neutral-700">Scan with any UPI app</p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
