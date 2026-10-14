"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { cn } from "@/lib/utils";

/** Two wake-up events in a row (tab visible + bfcache restore) refresh once. */
const MIN_GAP_MS = 5_000;

/**
 * Keeps the buyer's order page current without polling.
 *
 * The page is rendered once on the server, so "waiting for payment" would stay
 * on screen for ever. Buyers leave it to pay in a UPI app and come back, which
 * is exactly when the status may have changed: the page re-reads the order when
 * the tab becomes visible again or is restored from the back/forward cache.
 * "Check for update" does the same on demand. Event-driven only — no timer, so
 * an open order page never keeps the database awake.
 *
 * `auto` is off once the order can no longer change (delivered, cancelled).
 * `checkedAt` is the server render time, already formatted in IST.
 */
export function OrderRefresh({
  auto = true,
  checkedAt,
  className,
}: {
  auto?: boolean;
  checkedAt: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRef = useRef(0);

  useEffect(() => {
    if (!auto) return;
    const refresh = () => {
      const now = Date.now();
      if (now - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = now;
      startTransition(() => router.refresh());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // `persisted` = restored from the back/forward cache, i.e. a stale copy.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [auto, router]);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <button
        type="button"
        onClick={() => {
          lastRef.current = Date.now();
          startTransition(() => router.refresh());
        }}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-current/30 bg-background/70 px-4 text-sm font-bold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-70"
      >
        <RefreshCw
          className={cn("h-4 w-4 shrink-0", pending && "animate-spin motion-reduce:animate-none")}
          aria-hidden="true"
        />
        {pending ? "Checking…" : "Check for update"}
      </button>
      <p className="text-xs" role="status" aria-live="polite">
        {pending ? "Checking…" : `Checked at ${checkedAt}`}
      </p>
    </div>
  );
}
