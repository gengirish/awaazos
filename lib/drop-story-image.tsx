import { formatFulfilmentWindow, formatIstDayLabel, formatIstTime } from "@/lib/drops-time";
import { fulfilmentModeLabel, OG_COLORS as C, Price, truncate } from "@/lib/og-parts";
import { prisma } from "@/lib/prisma";

/**
 * Instagram story image for one Drop (1080×1920 PNG), rendered by
 * GET /api/drops/[id]/story-image for the vendor to post with a link sticker.
 *
 * Instagram draws its own chrome over roughly the top 250 px and bottom 340 px
 * of a story, so everything sits inside STORY_SAFE. The storefront URL is
 * printed as text too: the link sticker is optional and easy to forget.
 *
 * Vendor-only: loaded with a compound `{ id, vendorId }` where, and the
 * `select` is an allowlist — never `phone` / `email`. Satori's default font is
 * Latin-only, same as the storefront link preview.
 */

export const STORY_SIZE = { width: 1080, height: 1920 };
export const STORY_MAX_ITEMS = 6;
export const STORY_SAFE = { top: 260, bottom: 360, side: 80 };

export async function loadDropStory(dropId: string, vendorId: string) {
  const drop = await prisma.drop.findFirst({
    where: { id: dropId, vendorId },
    select: {
      title: true,
      closesAt: true,
      fulfilmentMode: true,
      fulfilmentStartsAt: true,
      fulfilmentEndsAt: true,
      vendor: { select: { name: true, city: true, slug: true } },
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { priceInPaise: true, menuItem: { select: { name: true } } },
      },
    },
  });
  if (!drop) return null;
  return {
    vendorName: drop.vendor.name,
    city: drop.vendor.city,
    slug: drop.vendor.slug,
    title: drop.title,
    closesAt: drop.closesAt,
    fulfilmentMode: drop.fulfilmentMode,
    fulfilmentStartsAt: drop.fulfilmentStartsAt,
    fulfilmentEndsAt: drop.fulfilmentEndsAt,
    items: drop.items.map((it) => ({ name: it.menuItem.name, priceInPaise: it.priceInPaise })),
  };
}

export type DropStory = NonNullable<Awaited<ReturnType<typeof loadDropStory>>>;

/** "awaazos.intelliforge.tech/s/ragi-kitchen" — no scheme, it reads better on a story. */
export function storyOrderUrl(host: string, slug: string): string {
  return `${host}/s/${encodeURIComponent(slug)}`;
}

export function DropStoryCard({ story, host }: { story: DropStory; host: string }) {
  const shown = story.items.slice(0, STORY_MAX_ITEMS);
  const more = story.items.length - shown.length;
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
          {truncate(story.vendorName, 32)}
          {story.city ? ` · ${truncate(story.city, 18)}` : ""}
        </div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>
          {truncate(story.title, 40)}
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
            <span>{truncate(it.name, 28)}</span>
            <Price paise={it.priceInPaise} fontSize={48} />
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
          {`Order by ${formatIstDayLabel(story.closesAt)}, ${formatIstTime(story.closesAt)}`}
        </div>
        <div style={{ display: "flex", fontSize: 34, color: C.muted, marginTop: 20 }}>
          {`${fulfilmentModeLabel(story.fulfilmentMode)} ${formatFulfilmentWindow(story.fulfilmentStartsAt, story.fulfilmentEndsAt)}`}
        </div>
        <div style={{ display: "flex", fontSize: 36, color: C.ink, marginTop: 40 }}>
          {truncate(storyOrderUrl(host, story.slug), 46)}
        </div>
      </div>
    </div>
  );
}
