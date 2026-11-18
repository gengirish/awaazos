"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { listSales, OUTBOX_CHANGED_EVENT } from "@/lib/pos-outbox";

/**
 * Shown on seller pages served on an old domain once a move is on
 * (lib/canonical-host.ts, docs/DOMAIN_MOVE_PLAN.md). The layout renders it only
 * then, so it costs nothing until CANONICAL_HOST is set.
 *
 * Sign-ins and Home Screen apps belong to one domain, so the seller signs in
 * again and reinstalls there. Counter sales queued offline live in this
 * domain's storage too: while any are left, it asks the seller to stay until
 * they sync instead of offering the new link.
 */
export function MovedHostNotice({ canonicalHost, vendorId }: { canonicalHost: string; vendorId: string }) {
  const pathname = usePathname();
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    const refresh = () => {
      listSales(vendorId)
        .then((sales) => setUnsynced(sales.length))
        .catch(() => setUnsynced(0));
    };
    refresh();
    window.addEventListener(OUTBOX_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, refresh);
  }, [vendorId]);

  const href = `https://${canonicalHost}${pathname ?? "/home"}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="app-shell-chrome border-b border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
    >
      {unsynced > 0 ? (
        <p>
          We&apos;ve moved to <strong>{canonicalHost}</strong>. {unsynced === 1 ? "1 sale" : `${unsynced} sales`} on
          this phone haven&apos;t synced yet. Stay online on this page until they do, then move.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1">
            We&apos;ve moved to <strong>{canonicalHost}</strong>. Open it, sign in, and add it to your Home Screen
            again. Your store link and old QR codes keep working.
          </p>
          <a
            href={href}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground"
          >
            Open {canonicalHost}
          </a>
        </div>
      )}
    </div>
  );
}
