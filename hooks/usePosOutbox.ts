"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listSales,
  needsSignIn as readNeedsSignIn,
  OUTBOX_CHANGED_EVENT,
  pendingTodayPaise,
  removeSale,
  syncOutbox,
  type OutboxSale,
} from "@/lib/pos-outbox";

/**
 * This device's queued sales for one vendor, plus the sync triggers.
 *
 * Syncs on mount, on `online`, and when the tab becomes visible. No timer:
 * an idle POS must not keep Neon awake (see lib/pos-outbox.ts).
 */
export function usePosOutbox(vendorId: string) {
  const [sales, setSales] = useState<OutboxSale[]>([]);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const refresh = useCallback(() => {
    listSales(vendorId)
      .then(setSales)
      .catch(() => setSales([]));
    setNeedsSignIn(readNeedsSignIn(vendorId));
  }, [vendorId]);

  const sync = useCallback(() => {
    void syncOutbox(vendorId);
  }, [vendorId]);

  useEffect(() => {
    refresh();
    sync();

    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener(OUTBOX_CHANGED_EVENT, refresh);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(OUTBOX_CHANGED_EVENT, refresh);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, sync]);

  const discard = useCallback((clientRef: string) => removeSale(vendorId, clientRef), [vendorId]);

  const pending = sales.filter((s) => s.status === "pending");
  const failed = sales.filter((s) => s.status === "failed");

  return {
    pending,
    failed,
    needsSignIn,
    pendingTodayPaise: pendingTodayPaise(sales),
    sync,
    discard,
  };
}
