import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One icon action in a row of the pre-orders table (`/drops`). Shared by the
 * server-rendered links and the client buttons (Share, Copy for tomorrow) so
 * every tile is the same size.
 *
 * - 44×44 at every width (tablets in landscape reach `lg` with a finger).
 * - Below `lg` a tiny word sits under the icon; from `lg` the icon stands
 *   alone and the `title` tooltip names it for mouse users.
 * - The accessible name is the caller's `aria-label`, which starts with the
 *   visible word (label-in-name) and names the pre-order.
 * - `primary` marks the row's next step, so the guidance the old cards gave
 *   with a big button survives as one filled tile.
 */
export function dropRowActionClass(primary: boolean, className?: string): string {
  return cn(
    "inline-flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
    primary
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
    className,
  );
}

/** The word under the icon on phones and tablets; hidden from `lg` (the aria-label names the tile). */
export function DropRowActionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] leading-none lg:hidden" aria-hidden="true">
      {children}
    </span>
  );
}
