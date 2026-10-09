"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Eye, EyeOff, Settings } from "lucide-react";

import { formatINR } from "@/lib/currency";

export type PosHeaderProps = {
  stallName: string;
  todaysRevenuePaise: number;
  /** Today's sales saved on this device that haven't synced yet. */
  pendingPaise?: number;
  /** Public storefront path (`/s/<slug>`); omitted when the store isn't published. */
  storePath?: string | null;
};

const ICON_BTN =
  "flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Per-device preference: hide today's takings from a customer looking at the screen. */
const HIDE_REVENUE_KEY = "awz_pos_hide_revenue_v1";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_REVENUE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(HIDE_REVENUE_KEY, "1");
    else window.localStorage.removeItem(HIDE_REVENUE_KEY);
  } catch {
    // Private mode / blocked storage: the toggle still works for this page view.
  }
}

export function PosHeader({ stallName, todaysRevenuePaise, pendingPaise = 0, storePath }: PosHeaderProps) {
  // Default shown; the stored preference is applied after mount so the server
  // render and the first client render agree. Until it has been read
  // (`prefLoaded`), the amount is masked so a vendor who chose "hidden" never
  // sees the real total flash on load.
  const [hidden, setHidden] = useState(false);
  const [prefLoaded, setPrefLoaded] = useState(false);

  useEffect(() => {
    setHidden(readHidden());
    setPrefLoaded(true);
  }, []);

  const masked = hidden || !prefLoaded;

  const toggle = () => {
    setHidden((prev) => {
      const next = !prev;
      writeHidden(next);
      return next;
    });
  };

  return (
    <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold text-foreground">{stallName}</h1>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today (IST)</p>
        <div className="flex items-center gap-1">
          <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {!prefLoaded ? (
              <span aria-hidden className="text-muted-foreground">
                ₹ ••••
              </span>
            ) : hidden ? (
              <>
                <span aria-hidden>₹ ••••</span>
                <span className="sr-only">Hidden</span>
              </>
            ) : (
              formatINR(todaysRevenuePaise + pendingPaise)
            )}
          </p>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={hidden}
            aria-label="Hide today's total"
            title={hidden ? "Show today's total" : "Hide today's total"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {hidden ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
          </button>
        </div>
        {pendingPaise > 0 && !masked ? (
          <p className="text-xs text-muted-foreground">incl. {formatINR(pendingPaise)} not yet synced</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {storePath ? (
          <a href={storePath} target="_blank" rel="noopener noreferrer" className={ICON_BTN}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Live store
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        <Link href="/settings" className={ICON_BTN} aria-label="Settings">
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
