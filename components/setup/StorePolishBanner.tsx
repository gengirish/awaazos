"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { StorePolishNudge } from "@/lib/orders-banner";
import { cn } from "@/lib/utils";

function namesText(names: string[]): string {
  const shown = names.slice(0, 2).map((n) => `“${n}”`);
  return names.length > 2 ? `${shown.join(", ")} and ${names.length - 2} more` : shown.join(" and ");
}

/**
 * The one-time "your store still looks unfinished" nudge (`storePolishNudge`,
 * lib/orders-banner.ts) in the orders board's banner slot. "Got it" hides that
 * reason on this device for good.
 */
export function StorePolishBanner({
  nudge,
  catalogue,
  onDismiss,
  className,
}: {
  nudge: StorePolishNudge;
  /** "menu" / "products" (`StoreVocabulary.catalogue`). */
  catalogue: string;
  onDismiss: () => void;
  className?: string;
}) {
  const testItems = nudge.kind === "test_items";
  return (
    <aside
      aria-label="Store check"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-2 shadow-xs", className)}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium text-foreground">
          {testItems
            ? `Customers can see ${namesText(nudge.names)} on your ${catalogue}`
            : "Your store has no tagline yet"}
        </p>
        <p className="text-sm text-muted-foreground">
          {testItems
            ? "Rename or hide test items before you share your store link."
            : "One line under your store name is the first thing buyers read, and it shows when you share the link."}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild>
          <Link href={testItems ? "/menu" : "/settings/store"}>{testItems ? `Open ${catalogue}` : "Add a tagline"}</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </aside>
  );
}
