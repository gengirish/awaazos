import { ChevronRight, CircleDashed, ListChecks } from "lucide-react";
import Link from "next/link";

import { ShareStoreButton } from "@/components/storefront/ShareStoreButton";
import type { ChecklistItem } from "@/lib/settings-overview";
import { cn } from "@/lib/utils";

import { CopyStoreLinkButton } from "./CopyStoreLinkButton";

export type SetupChecklistCardProps = {
  /** Open steps the viewer can act on (`loadSetupChecklist`). Empty → renders nothing. */
  items: ChecklistItem[];
  /** The published store: shows its link with Copy and Share. Null/omitted while unpublished. */
  store?: { slug: string; name: string } | null;
  /**
   * `card` (default): the open list. `compact`: one 44 px row that expands on
   * tap, for screens where the list must not push the work down (the till).
   */
  variant?: "card" | "compact";
  /** Pass "p" where the card sits above the page's `<h1>`, to keep the heading order. */
  titleAs?: "h2" | "p";
  className?: string;
};

const TITLE = "Setup checklist: start taking online orders";

const BOX = "rounded-lg border border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50";

const FOCUS = "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

function stepsLeft(n: number): string {
  return `${n} ${n === 1 ? "step" : "steps"} left`;
}

function Steps({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            className={cn(
              "flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm font-medium underline-offset-4 hover:underline",
              FOCUS,
            )}
          >
            <span className="flex items-center gap-2">
              <CircleDashed className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="sr-only">To do: </span>
                {item.text}
              </span>
            </span>
            <span className="sr-only">{item.linkText}</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
          {item.hint ? <p className="px-2 pb-1 pl-8 text-xs">{item.hint}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function StoreLink({ store }: { store: { slug: string; name: string } }) {
  const path = `/s/${encodeURIComponent(store.slug)}`;
  return (
    <div className="mt-3 border-t border-amber-500/40 pt-3">
      <p className="text-sm">
        Your store link is live. Put it in your Instagram bio:
        <span className="mt-0.5 block break-all font-mono text-xs">{path}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyStoreLinkButton slug={store.slug} />
        <ShareStoreButton vendorName={store.name} slug={store.slug} />
      </div>
    </div>
  );
}

/**
 * What is still missing before customers can order online, each step a link to
 * where it is fixed. Server-rendered from `loadSetupChecklist()`
 * (lib/setup-checklist-server.ts); it disappears once every step is done.
 *
 *   const setup = await loadSetupChecklist({ vendor: ctx.vendor, role: ctx.staff.role });
 *   <SetupChecklistCard {...setup} className="mb-4" />
 */
export function SetupChecklistCard({
  items,
  store = null,
  variant = "card",
  titleAs: Title = "h2",
  className,
}: SetupChecklistCardProps) {
  if (items.length === 0) return null;

  if (variant === "compact") {
    return (
      <details className={cn("group", BOX, className)}>
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden",
            FOCUS,
          )}
        >
          <span className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
              Start taking online orders <span className="font-normal">· {stepsLeft(items.length)}</span>
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="px-4 pb-4">
          <Steps items={items} />
          {store ? <StoreLink store={store} /> : null}
        </div>
      </details>
    );
  }

  return (
    <section aria-label={TITLE} className={cn("p-4", BOX, className)}>
      <Title className="flex items-center gap-2 font-display text-base font-semibold">
        <ListChecks className="h-5 w-5 shrink-0" aria-hidden="true" />
        {TITLE}
      </Title>
      <Steps items={items} />
      {store ? <StoreLink store={store} /> : null}
    </section>
  );
}
