import { STORY_MAX_ITEMS, STORY_SAFE, storyOrderUrl } from "@/lib/drop-story-image";
import { fulfilmentModeLabel, OG_COLORS as C, Price, truncate } from "@/lib/og-parts";
import { prisma } from "@/lib/prisma";
import { STOREFRONT_MENU_ITEM_WHERE } from "@/lib/storefront-order";

/**
 * Instagram story image for the whole store (1080×1920 PNG), for kitchens that
 * sell from their everyday menu rather than drops. Rendered by
 * GET /api/vendor/story-image; same frame, safe zones and font rules as the
 * drop story (lib/drop-story-image.tsx).
 *
 * Items are the ones the storefront shows (STOREFRONT_MENU_ITEM_WHERE),
 * bestsellers first. The `select` is an allowlist — never `phone` / `email`.
 */

export async function loadStoreStory(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      name: true,
      city: true,
      slug: true,
      settings: {
        select: { publishStorefront: true, acceptMenuOrders: true, menuFulfilmentMode: true, menuPickupNote: true },
      },
      menuItems: {
        where: STOREFRONT_MENU_ITEM_WHERE,
        orderBy: [{ isPopular: "desc" }, { category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        take: 50,
        select: { name: true, priceInPaise: true, unit: true },
      },
    },
  });
  if (!vendor) return null;
  return {
    vendorName: vendor.name,
    city: vendor.city,
    slug: vendor.slug,
    published: vendor.settings?.publishStorefront ?? false,
    acceptMenuOrders: vendor.settings?.acceptMenuOrders ?? false,
    fulfilmentMode: vendor.settings?.menuFulfilmentMode ?? "PICKUP",
    pickupNote: vendor.settings?.menuPickupNote ?? null,
    items: vendor.menuItems,
  };
}

export type StoreStory = NonNullable<Awaited<ReturnType<typeof loadStoreStory>>>;

export function StoreStoryCard({ story, host }: { story: StoreStory; host: string }) {
  const shown = story.items.slice(0, STORY_MAX_ITEMS);
  const more = story.items.length - shown.length;
  const pickupNote = story.fulfilmentMode !== "DELIVERY" ? story.pickupNote?.trim() : "";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.surface,
        borderTop: `24px solid ${C.primary}`,
        padding: `${STORY_SAFE.top}px ${STORY_SAFE.side}px ${STORY_SAFE.bottom}px`,
        color: C.ink,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 44, color: C.primary, fontWeight: 700 }}>
          {story.acceptMenuOrders ? "Now taking orders" : "Our menu"}
          {story.city ? ` · ${truncate(story.city, 18)}` : ""}
        </div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>
          {truncate(story.vendorName, 40)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((it, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 48,
              padding: "18px 0",
              borderBottom: `2px solid ${C.rule}`,
            }}
          >
            <span>{truncate(it.name, 26)}</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Price paise={it.priceInPaise} fontSize={48} />
              {it.unit ? (
                <span style={{ fontSize: 34, color: C.muted, marginLeft: 8 }}>{`/ ${truncate(it.unit, 8)}`}</span>
              ) : null}
            </div>
          </div>
        ))}
        {more > 0 ? (
          <div style={{ display: "flex", fontSize: 40, color: C.muted, marginTop: 18 }}>{`and ${more} more`}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            fontSize: 52,
            fontWeight: 700,
            background: C.tint,
            borderRadius: 20,
            padding: "16px 28px",
          }}
        >
          {story.acceptMenuOrders ? "Tap the link to order" : "Tap the link for the menu"}
        </div>
        {story.acceptMenuOrders ? (
          <div style={{ display: "flex", fontSize: 34, color: C.muted, marginTop: 20 }}>
            {pickupNote
              ? `${fulfilmentModeLabel(story.fulfilmentMode)} · ${truncate(pickupNote, 40)}`
              : fulfilmentModeLabel(story.fulfilmentMode)}
          </div>
        ) : null}
        <div style={{ display: "flex", fontSize: 36, color: C.ink, marginTop: 40 }}>
          {truncate(storyOrderUrl(host, story.slug), 46)}
        </div>
      </div>
    </div>
  );
}
