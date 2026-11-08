import { z } from "zod";

import {
  RESERVED_STORE_HANDLES,
  STORE_HANDLE_FORMAT_MESSAGE,
  STORE_HANDLE_LENGTH_MESSAGE,
  STORE_HANDLE_MAX,
  STORE_HANDLE_MIN,
  STORE_HANDLE_PATTERN,
  STORE_HANDLE_RESERVED_MESSAGE,
} from "@/lib/store-handle";

/**
 * Community pages: one public page per housing society ("SDG Home Kitchens")
 * at `/c/<slug>`, listing the stores of the home kitchens that live there.
 * It is a directory of links, not a marketplace: no cart across stores, no
 * search, no ranking, no reviews. Every order still happens on `/s/<slug>`.
 *
 * Rules:
 *
 *   1. A platform ADMIN makes the page and invites stores
 *      (/admin/communities). An invite lists nothing.
 *   2. The store's OWNER accepts in Settings → Online store; only then is the
 *      store listed. Leaving or declining deletes the row.
 *   3. The public page shows a store only while it is listed AND would be
 *      shown on its own: active, `publishStorefront` on, not a demo store.
 *      Anything else is left out silently, so the page never says why.
 *   4. The page reads the same allowlist as the storefront header (name, type,
 *      city, logo, slug) plus whether the store is taking orders. Never phone,
 *      email, UPI or owner name.
 *   5. No timers. Whether a pre-order is open is worked out on each render
 *      with `effectiveDropStatus`, as on the storefront.
 *
 * Client-safe (no Prisma). The queries live in lib/community-server.ts.
 */

export const COMMUNITY_NAME_MAX = 80;
export const COMMUNITY_AREA_MAX = 80;
export const COMMUNITY_DESCRIPTION_MAX = 280;
/** Stores the public page lists, at most. A society page, not a city one. */
export const COMMUNITY_STORE_LIMIT = 100;

/** Community links follow the store-link rules (lib/store-handle.ts). */
export const communitySlugSchema = z
  .string()
  .trim()
  .min(STORE_HANDLE_MIN, STORE_HANDLE_LENGTH_MESSAGE)
  .max(STORE_HANDLE_MAX, STORE_HANDLE_LENGTH_MESSAGE)
  .regex(STORE_HANDLE_PATTERN, STORE_HANDLE_FORMAT_MESSAGE)
  .refine((s) => !RESERVED_STORE_HANDLES.has(s), STORE_HANDLE_RESERVED_MESSAGE);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

export const communityCreateSchema = z.object({
  slug: communitySlugSchema,
  name: z.string().trim().min(3, "Use at least 3 characters.").max(COMMUNITY_NAME_MAX),
  area: optionalText(COMMUNITY_AREA_MAX),
  description: optionalText(COMMUNITY_DESCRIPTION_MAX),
});
export type CommunityCreateInput = z.infer<typeof communityCreateSchema>;

export const communityUpdateSchema = communityCreateSchema.partial();
export type CommunityUpdateInput = z.infer<typeof communityUpdateSchema>;

export const communityInviteSchema = z.object({
  /** The store link, as typed or pasted: "ravis-bhel", "/s/ravis-bhel" or the full URL. */
  store: z.string().trim().min(1).max(300),
});

/** "https://…/s/ravis-bhel?x=1" → "ravis-bhel". Anything else is returned lowercased and trimmed. */
export function storeSlugFromInput(raw: string): string {
  const s = raw.trim().toLowerCase();
  const m = s.match(/(?:^|\/)s\/([a-z0-9-]+)/);
  return m ? m[1] : s.replace(/^\/+|\/+$/g, "");
}

// ─── Public page view ──────────────────────────────────────────────

/** What the public page knows about one listed store's ordering right now. */
export type CommunityStoreOrdering =
  | { kind: "drop_open"; title: string; closesAt: Date }
  | { kind: "drop_scheduled"; title: string; opensAt: Date }
  | { kind: "menu" }
  | { kind: "browse" };

export type CommunityStoreInput = {
  slug: string;
  name: string;
  acceptMenuOrders: boolean;
  /** Stored-OPEN drops, any order; this function applies the clock. */
  drops: { title: string; status: string; opensAt: Date | null; closesAt: Date }[];
};

/**
 * What a store's card says, from its open drops and menu switch. Pre-orders
 * taking orders now win (the soonest cut-off first), then pre-orders that
 * open later, then "order from menu", then a plain link to the menu.
 * Mirrors `effectiveDropStatus` (lib/drops.ts) without importing Prisma types.
 */
export function communityStoreOrdering(store: CommunityStoreInput, now: Date): CommunityStoreOrdering {
  const t = now.getTime();
  const live = store.drops.filter((d) => d.status === "OPEN" && d.closesAt.getTime() > t);
  const open = live
    .filter((d) => !d.opensAt || d.opensAt.getTime() <= t)
    .sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  if (open.length > 0) return { kind: "drop_open", title: open[0].title, closesAt: open[0].closesAt };
  const scheduled = live
    .filter((d): d is typeof d & { opensAt: Date } => d.opensAt !== null && d.opensAt.getTime() > t)
    .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  if (scheduled.length > 0) {
    return { kind: "drop_scheduled", title: scheduled[0].title, opensAt: scheduled[0].opensAt };
  }
  return store.acceptMenuOrders ? { kind: "menu" } : { kind: "browse" };
}

const ORDERING_RANK: Record<CommunityStoreOrdering["kind"], number> = {
  drop_open: 0,
  drop_scheduled: 1,
  menu: 2,
  browse: 3,
};

/**
 * Page order: stores taking pre-orders now (soonest cut-off first), then
 * ones opening later, then menu ordering, then the rest; ties by name. Being
 * open is the only thing that moves a store up — there is no paid placement.
 */
export function sortCommunityStores<T extends { name: string; ordering: CommunityStoreOrdering }>(
  stores: readonly T[],
): T[] {
  const when = (o: CommunityStoreOrdering) =>
    o.kind === "drop_open" ? o.closesAt.getTime() : o.kind === "drop_scheduled" ? o.opensAt.getTime() : 0;
  return [...stores].sort(
    (a, b) =>
      ORDERING_RANK[a.ordering.kind] - ORDERING_RANK[b.ordering.kind] ||
      when(a.ordering) - when(b.ordering) ||
      a.name.localeCompare(b.name, "en-IN", { sensitivity: "base" }),
  );
}

/** A community page as its invited or listed store's owner sees it in Settings. */
export type VendorCommunity = {
  id: string;
  slug: string;
  name: string;
  area: string | null;
  accepted: boolean;
};

/** Admin-facing error codes → text, shared by the admin forms. */
export const COMMUNITY_ERROR_TEXT: Record<string, string> = {
  community_slug_taken: "That link is already used by another community page.",
  store_not_found: "No store has that link. Copy it from the store's page.",
  demo_store: "Demo stores can't be listed.",
  already_invited: "That store is already on this page or invited.",
  not_found: "That community page no longer exists. Reload.",
};
