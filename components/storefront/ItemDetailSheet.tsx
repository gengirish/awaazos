"use client";

import { CalendarClock, Clock, MapPin, Tag, Truck, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { FoodMark } from "@/components/storefront/FoodMark";
import { ItemPhoto } from "@/components/storefront/ItemPhoto";
import { ItemPhotoGallery } from "@/components/storefront/ItemPhotoGallery";
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
import { FOOD_TYPE_LABEL, type FoodType, type Highlight } from "@/lib/item-highlights";
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
  /** Photos after the cover; with any, the top is a swipeable gallery (ItemPhotoGallery). */
  morePhotos?: readonly string[];
  /** The picked colour's photo (lib/item-variants.ts rule 8): the gallery turns to it. */
  focusPhoto?: string | null;
  description?: string | null;
  /** Label / value pairs, shown as a two-column list (lib/item-highlights.ts). */
  highlights?: readonly Highlight[];
  /** The longer text, line breaks kept. */
  details?: string | null;
  /** The food mark with its word (kitchens only). */
  foodType?: FoodType | null;
  /** `ItemPriceHero`. */
  price: ReactNode;
  /** Popular, "Only 3 left", "Sold out", "Max 2 per order". */
  badges?: ReactNode;
  /** `SizePicker` with a group name of its own (the row's is already on the page). */
  sizes?: ReactNode;
  /** `offersForItem`. */
  offers?: readonly ResolvedOffer[];
  facts?: readonly DetailFact[];
  /** "Share this item" (a ShareStoreButton on the product link). */
  share?: ReactNode;
  /** Price of the picked line, left of the action. */
  footerPrice?: ReactNode;
  /** The stepper, or a "Sold out" note; absent = no footer. */
  action?: ReactNode;
  dimmed?: boolean;
  /**
   * The store's colour (`storeThemeAttribute`). The sheet is portalled to
   * <body>, outside the page's `data-theme`, so it carries its own.
   */
  theme?: string;
};

const FACT_ICON: Record<DetailFactKind, typeof Clock> = {
  when: CalendarClock,
  deadline: Clock,
  pickup: MapPin,
  delivery: Truck,
  payment: Wallet,
};

export function ItemDetailSheet(props: ItemDetailSheetProps) {
  const { open, onOpenChange, triggerId, name, emoji, imageUrl, morePhotos = [], focusPhoto = null, description, highlights = [], details, foodType, price, badges, sizes, offers = [], facts = [], share, footerPrice, action, dimmed, theme } = props;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        data-theme={theme}
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
          {imageUrl && morePhotos.length > 0 ? (
            <ItemPhotoGallery photos={[imageUrl, ...morePhotos]} name={name} dimmed={dimmed} focus={focusPhoto} />
          ) : (
            <ItemPhoto src={imageUrl} emoji={emoji} name={name} size="hero" enlarge dimmed={dimmed} />
          )}

          {badges || foodType ? (
            <div className="flex flex-wrap items-center gap-2">
              {foodType ? <FoodMark type={foodType} label="visible" /> : null}
              {badges}
            </div>
          ) : null}

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

          {highlights.length > 0 ? (
            <section aria-labelledby={`${triggerId}-highlights`} className="space-y-2">
              <h3 id={`${triggerId}-highlights`} className="text-sm font-semibold text-foreground">
                Highlights
              </h3>
              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm">
                {highlights.map((h) => (
                  <div key={h.label} className="contents">
                    <dt className="text-muted-foreground">{h.label}</dt>
                    <dd className="font-medium text-foreground">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {details ? (
            <section aria-labelledby={`${triggerId}-details`} className="space-y-1">
              <h3 id={`${triggerId}-details`} className="text-sm font-semibold text-foreground">
                Details
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{details}</p>
            </section>
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

          {share ? <div className="flex justify-end">{share}</div> : null}
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
  foodType,
  onOpen,
  children,
}: {
  /** Unique on the page (a menu item id, a drop item id): the sheet's `triggerId`. */
  detailId: string;
  name: string;
  description?: string | null;
  /** The food mark (kitchens only), drawn before the name and said after it ("Paneer Tikka (Veg)"). */
  foodType?: FoodType | null;
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
        {foodType ? <FoodMark type={foodType} label="none" /> : null}
        <span className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-snug text-foreground underline-offset-2 hover:underline">
          {name}
          {foodType ? <span className="sr-only"> ({FOOD_TYPE_LABEL[foodType]})</span> : null}
        </span>
        {children}
      </span>
      {description ? <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{description}</span> : null}
    </button>
  );
}
