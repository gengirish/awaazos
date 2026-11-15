"use client";

import { CalendarClock, Clock, MapPin, Tag, Truck, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { DetailFact, DetailFactKind } from "@/lib/item-detail";
import { offerSummary, type ResolvedOffer } from "@/lib/offers";

/**
 * One item's detail on the public store, over the store page: a bottom sheet on
 * a phone, a dialog from `md` (ResponsiveDialog). What Flipkart's product page
 * gives a buyer, cut to what a home seller's item has: the big photo, the price
 * with the discount first, sizes, stock, the whole description, the offers it
 * counts toward, how it is handed over and paid for, and Add at the bottom.
 *
 * Presentational only. The list that owns the item's cart (MenuOrder,
 * DropOrder) renders this with its own price, size picker and stepper, so Add
 * here and the stepper on the row are one state. A read-only menu passes no
 * `action`, and the footer is left out.
 */
export type ItemDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The `detailId` of the item's `ItemDetailTrigger`: focus goes back to it on close. */
  triggerId: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  description?: string | null;
  /** `ItemPriceHero`. */
  price: ReactNode;
  /** Popular, "Only 3 left", "Sold out", "Max 2 per order". */
  badges?: ReactNode;
  /** `SizePicker` with a group name of its own (the row's is already on the page). */
  sizes?: ReactNode;
  /** `offersForItem`. */
  offers?: readonly ResolvedOffer[];
  facts?: readonly DetailFact[];
  /** Price of the picked line, left of the action. */
  footerPrice?: ReactNode;
  /** The stepper, or a "Sold out" note; absent = no footer. */
  action?: ReactNode;
  dimmed?: boolean;
};

const FACT_ICON: Record<DetailFactKind, typeof Clock> = {
  when: CalendarClock,
  deadline: Clock,
  pickup: MapPin,
  delivery: Truck,
  payment: Wallet,
};

export function ItemDetailSheet(props: ItemDetailSheetProps) {
  const { open, onOpenChange, triggerId, name, emoji, imageUrl, description, price, badges, sizes, offers = [], facts = [], footerPrice, action, dimmed } = props;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="md:max-w-xl"
        // Radix returns focus only to its own Trigger; this sheet opens from a plain button.
        onCloseAutoFocus={(e) => {
          const trigger = document.querySelector<HTMLElement>(`[data-detail-trigger="${CSS.escape(triggerId)}"]`);
          if (trigger) {
            e.preventDefault();
            trigger.focus();
          }
        }}
      >
        <ResponsiveDialogHeader className="pb-2">
          <ResponsiveDialogTitle className="font-display text-xl">{name}</ResponsiveDialogTitle>
          {/* The price is the one-line summary a screen reader reads after the name. */}
          <ResponsiveDialogDescription asChild>
            <div className="text-foreground">{price}</div>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          <ItemPhoto src={imageUrl} emoji={emoji} name={name} size="hero" enlarge dimmed={dimmed} />

          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}

          {sizes}

          {description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{description}</p>
          ) : null}

          {offers.length > 0 ? (
            <ul aria-label="Offers" className="space-y-1.5 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2 text-sm">
              {offers.map((o) => (
                <li key={o.id} className="flex items-start gap-2">
                  <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="font-semibold text-foreground">{offerSummary(o)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {facts.length > 0 ? (
            <ul aria-label="How you get it" className="space-y-1.5 border-t border-border/60 pt-3 text-sm text-muted-foreground">
              {facts.map((f) => {
                const Icon = FACT_ICON[f.kind];
                return (
                  <li key={f.kind} className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{f.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </ResponsiveDialogBody>
        {action ? (
          <ResponsiveDialogFooter className="flex-row items-center justify-between gap-3 md:justify-between md:pt-3">
            <span className="min-w-0 truncate font-mono text-lg font-bold tabular-nums text-foreground">{footerPrice}</span>
            {action}
          </ResponsiveDialogFooter>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * The name (and one-line description) on a row or tile, as the button that opens
 * the detail sheet: the accessible way in (the photo is a pointer-only copy).
 */
export function ItemDetailTrigger({
  detailId,
  name,
  description,
  onOpen,
  children,
}: {
  /** Unique on the page (a menu item id, a drop item id): the sheet's `triggerId`. */
  detailId: string;
  name: string;
  description?: string | null;
  onOpen: () => void;
  /** Extra inline content after the name (badges on the read-only row). */
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-detail-trigger={detailId}
      aria-haspopup="dialog"
      className="flex min-h-11 w-full min-w-0 flex-col justify-center gap-0.5 rounded-lg text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-snug text-foreground underline-offset-2 hover:underline">
          {name}
        </span>
        {children}
      </span>
      {description ? <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{description}</span> : null}
    </button>
  );
}
