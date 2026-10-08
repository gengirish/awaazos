import Link from "next/link";
import { ExternalLink, Settings } from "lucide-react";

import { formatINR } from "@/lib/currency";

export type PosHeaderProps = {
  stallName: string;
  todaysRevenuePaise: number;
  /** Today's sales saved on this device that haven't synced yet. */
  pendingPaise?: number;
  /** Public storefront path (`/s/<slug>`); omitted when the store isn't published. */
  storePath?: string | null;
};

const HEADER_BTN =
  "flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function PosHeader({ stallName, todaysRevenuePaise, pendingPaise = 0, storePath }: PosHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground">{stallName}</h1>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today (IST)</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {formatINR(todaysRevenuePaise + pendingPaise)}
        </p>
        {pendingPaise > 0 ? (
          <p className="text-xs text-muted-foreground">incl. {formatINR(pendingPaise)} not yet synced</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {storePath ? (
          <a href={storePath} target="_blank" rel="noopener noreferrer" className={HEADER_BTN}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Live store
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        <Link href="/settings" className={HEADER_BTN} aria-label="Settings">
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
