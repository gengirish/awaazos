import { ImageResponse } from "next/og";

import { formatPercentBps } from "@/lib/offers";
import { OG_COLORS as C, Price, storeLogoDataUrl, truncate } from "@/lib/og-parts";
import { loadStorefrontProduct, type StorefrontProduct } from "@/lib/storefront-product";
import { BRAND_NAME } from "@/lib/brand";
import { SHARE_CARD_CACHE_CONTROL, SHARE_CARD_SIZE as size } from "@/lib/share-card";

/**
 * Link-preview card for a product link, /s/<slug>/p/<menuItemId>: what
 * Instagram and WhatsApp show when a seller shares one product. The item's
 * photo on the left; its name, price (struck-out price and "35% off" on a sale),
 * the store's name and logo on the right.
 *
 * Same gate and the same item rule as the page (`loadStorefrontProduct`).
 * Anything else, or a failed read, gets a generic card with nothing derived
 * from the URL: an image URL shouldn't 404, nor confirm what exists.
 *
 * The photo is drawn only when it loads in time as PNG or JPEG (Satori can't
 * draw WebP; seller uploads are shrunk to JPEG / PNG in the browser, so a
 * WebP is rare). Otherwise the item's emoji takes its place.
 *
 * Served by ./route.tsx at /s/<slug>/p/<itemId>/share-card (why not
 * opengraph-image.tsx: lib/share-card.ts). Rendered only when a crawler fetches a
 * shared link: event-driven, no timer.
 */

const RESPONSE = { ...size, headers: { "Cache-Control": SHARE_CARD_CACHE_CONTROL } };

const PHOTO = 630;

function GenericCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: C.surface,
        borderTop: `16px solid ${C.primary}`,
        padding: "56px 72px",
        color: C.ink,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>{`Order on ${BRAND_NAME}`}</div>
      <div style={{ display: "flex", fontSize: 36, color: C.muted, marginTop: 16 }}>Order online from local stores</div>
    </div>
  );
}

function ProductCard({
  product,
  photo,
  logo,
}: {
  product: StorefrontProduct;
  photo: string | null;
  logo: string | null;
}) {
  const { store, item } = product;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: C.surface, color: C.ink, fontFamily: "sans-serif" }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori draws a plain <img>
        <img src={photo} alt="" width={PHOTO} height={PHOTO} style={{ width: PHOTO, height: PHOTO, objectFit: "cover" }} />
      ) : (
        <div
          style={{
            display: "flex",
            width: PHOTO,
            height: PHOTO,
            alignItems: "center",
            justifyContent: "center",
            background: C.tint,
            fontSize: 220,
          }}
        >
          {item.emoji}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: "52px 48px",
          borderTop: `16px solid ${C.primary}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>{truncate(item.name, 48)}</div>
          {item.sale ? (
            <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
              <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: C.primary, marginRight: 20 }}>
                {`${formatPercentBps(item.sale.percentBps)} off`}
              </div>
              <div style={{ display: "flex", color: C.muted, textDecoration: "line-through" }}>
                <Price paise={item.priceInPaise} fontSize={34} />
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "baseline", marginTop: item.sale ? 8 : 24 }}>
            <Price paise={item.sale?.salePricePaise ?? item.priceInPaise} fontSize={64} />
            {item.unit ? (
              <div style={{ display: "flex", fontSize: 32, color: C.muted, marginLeft: 8 }}>{`/ ${truncate(item.unit, 12)}`}</div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws a plain <img>
            <img
              src={logo}
              alt=""
              width={88}
              height={88}
              style={{ width: 88, height: 88, borderRadius: 18, objectFit: "cover", marginRight: 20 }}
            />
          ) : null}
          {/* minWidth 0 lets this column shrink beside the logo instead of running off the card. */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "block", fontSize: 32, fontWeight: 700, lineHeight: 1.15, lineClamp: 2 }}>
              {truncate(store.name, 60)}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 4 }}>
              {store.city ? (
                <span style={{ display: "block", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                  {truncate(store.city, 40)}
                </span>
              ) : null}
              <span style={{ display: "flex", flexShrink: 0 }}>{store.city ? " · Order online" : "Order online"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function productShareCard(slug: string, itemId: string): Promise<Response> {
  let product: StorefrontProduct | null = null;
  try {
    product = await loadStorefrontProduct(slug, itemId);
  } catch (err) {
    // A preview image must never 500: fall back to the generic card.
    console.error("[og] product card load failed", err instanceof Error ? err.message : "unknown");
  }
  if (!product) return new ImageResponse(<GenericCard />, RESPONSE);

  // Only absolute URLs (seller uploads on Blob); a relative dish drawing is WebP anyway.
  const photoUrl = product.item.imageUrl?.startsWith("https://") ? product.item.imageUrl : null;
  const [photo, logo] = await Promise.all([storeLogoDataUrl(photoUrl), storeLogoDataUrl(product.store.logoUrl)]);
  return new ImageResponse(<ProductCard product={product} photo={photo} logo={logo} />, RESPONSE);
}
