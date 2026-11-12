import type { DropStatus } from "@prisma/client";

import { effectiveDropStatus } from "@/lib/drops";
import { STORE_THEME_LABELS, storeTheme } from "@/lib/store-theme";
import type { StoreVocabulary } from "@/lib/store-vocabulary";
import { formatIstDeadline } from "@/lib/storefront-order";

/**
 * The "Your store" screen (/store) in words. Pure: the page reads the rows, this
 * turns them into what the seller sees. Nothing is stored or scheduled; every
 * line is worked out again on each render from the drops' times (lib/drops.ts).
 */

export type HubDrop = { title: string; status: DropStatus; opensAt: Date | null; closesAt: Date };

export type OrderingLine = { tone: "on" | "soon"; text: string };

export type OrderingSummary = {
  /** Something buyers can order now or soon; empty when the store takes no orders. */
  lines: OrderingLine[];
  /** True when nothing is on and nothing is about to open. */
  idle: boolean;
};

/**
 * What buyers can order right now, one line per way in: the everyday catalogue
 * when "order any time" is on, each open drop with its cut-off, each drop that
 * opens later with its start. Only drops stored OPEN are passed in; a past
 * cut-off drops out here (`effectiveDropStatus`), never by a timer.
 */
export function storeOrderingSummary(
  input: { acceptMenuOrders: boolean; drops: HubDrop[] },
  vocab: Pick<StoreVocabulary, "catalogue">,
  now: Date = new Date(),
): OrderingSummary {
  const lines: OrderingLine[] = [];
  if (input.acceptMenuOrders) {
    lines.push({ tone: "on", text: `Buyers can order from your ${vocab.catalogue} any time.` });
  }
  const byCutoff = [...input.drops].sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  for (const drop of byCutoff) {
    const status = effectiveDropStatus(drop, now);
    if (status === "OPEN") {
      lines.push({ tone: "on", text: `${drop.title}: taking orders until ${formatIstDeadline(drop.closesAt, now)}.` });
    } else if (status === "SCHEDULED" && drop.opensAt) {
      lines.push({ tone: "soon", text: `${drop.title}: opens ${formatIstDeadline(drop.opensAt, now)}.` });
    }
  }
  return { lines, idle: lines.length === 0 };
}

export type LookRow = {
  /** Anchor of the matching card on Settings → Online store. */
  id: "banner-logo" | "store-colour" | "tagline" | "instagram";
  label: string;
  /** What is set now, or the nudge when nothing is. */
  value: string;
  done: boolean;
};

/** "Make it look like yours": each part of the store's look, whether it is set, and where to change it. */
export function storeLookRows(input: {
  bannerUrl: string | null;
  logoUrl: string | null;
  theme: string | null | undefined;
  tagline: string | null;
  instagramHandle: string | null;
}): LookRow[] {
  const images = [input.bannerUrl ? "banner" : null, input.logoUrl ? "logo" : null].filter(Boolean);
  return [
    {
      id: "banner-logo",
      label: "Banner & logo",
      value: images.length === 2 ? "Both added" : images.length === 1 ? `Only the ${images[0]}` : "Add a photo",
      done: images.length === 2,
    },
    {
      id: "store-colour",
      label: "Store colour",
      value: STORE_THEME_LABELS[storeTheme(input.theme)],
      // Orange is the default: any colour is a choice, so it never nags.
      done: true,
    },
    {
      id: "tagline",
      label: "Tagline",
      value: input.tagline ?? "Add one line about your store",
      done: Boolean(input.tagline),
    },
    {
      id: "instagram",
      label: "Instagram profile",
      value: input.instagramHandle ? `@${input.instagramHandle}` : "Add your handle",
      done: Boolean(input.instagramHandle),
    },
  ];
}
