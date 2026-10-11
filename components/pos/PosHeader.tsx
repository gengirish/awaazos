"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { formatINR } from "@/lib/currency";

export type PosHeaderProps = {
  stallName: string;
  todaysRevenuePaise: number;
  /** Today's sales saved on this device that haven't synced yet. */
  pendingPaise?: number;
};

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

/**
 * Store name and today's takings. Settings, Live store and Sign out used to
 * sit here; they are in the app shell's navigation now (components/shell).
 */
export function PosHeader({ stallName, todaysRevenuePaise, pendingPaise = 0 }: PosHeaderProps) {
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
    <header className="border-b border-border pb-4">
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
    </header>
  );
}
