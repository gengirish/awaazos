import { storeTheme, type StoreTheme } from "@/lib/store-theme";

/**
 * "Add <store> to your Home Screen": each published store installs as its own
 * app for its buyers, with the store's name, icon and colour. Pure and
 * client-safe; the routes are app/s/[slug]/manifest.webmanifest and
 * app/s/[slug]/app-icon/[size], the button is components/storefront/StoreInstall.tsx.
 *
 * Why not the site's manifest (app/manifest.ts): that one is the seller app,
 * scope "/" and start_url /home. A buyer who installed it from a store page
 * landed on sign-in.
 *
 * Identity and scope:
 *   - `id` and `scope` are the store link, `/s/<slug>`. Every page a buyer uses
 *     (the store, the order page, the account page) is under it, so they open
 *     inside the app. Scope is a prefix match, so `/s/sam` also covers
 *     `/s/sam-bakes`; nothing links one store to another, so that never shows.
 *   - `start_url` must sit inside the scope. `/s/<slug>/` would be, but Next
 *     redirects the trailing slash away, so it is the store link itself.
 *   - Changing the store link retires the old one (nothing redirects), so an
 *     app installed on the old link opens the store-not-found page.
 *
 * Nothing about the buyer goes in here, and of the store only what its public
 * page already shows: name, colour, logo.
 */

export const STORE_APP_ICON_SIZES = [180, 192, 512] as const;
export type StoreAppIconSize = (typeof STORE_APP_ICON_SIZES)[number];

export function isStoreAppIconSize(value: number): value is StoreAppIconSize {
  return (STORE_APP_ICON_SIZES as readonly number[]).includes(value);
}

export function storeAppPath(slug: string): string {
  return `/s/${slug}`;
}

export function storeManifestPath(slug: string): string {
  return `/s/${slug}/manifest.webmanifest`;
}

export function storeAppIconPath(slug: string, size: StoreAppIconSize): string {
  return `/s/${slug}/app-icon/${size}`;
}

/**
 * Each theme's `--primary` from app/globals.css, as HSL. The manifest, the
 * browser bar colour and the Satori icon can't read CSS variables, so the
 * values are repeated here; lib/__tests__/store-app.test.ts checks them
 * against globals.css.
 */
export const STORE_THEME_HSL: Record<StoreTheme, readonly [number, number, number]> = {
  orange: [25, 100, 37],
  green: [142, 72, 29],
  amber: [32, 95, 33],
  red: [0, 72, 51],
  blue: [221, 83, 53],
  purple: [262, 83, 58],
};

/** `#rrggbb` for an HSL triple (degrees, percent, percent). */
export function hslToHex([h, s, l]: readonly [number, number, number]): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The store's colour as hex: the app's theme colour and the icon's background. */
export function storeThemeHex(raw: string | null | undefined): string {
  return hslToHex(STORE_THEME_HSL[storeTheme(raw)]);
}

/** Android writes roughly 12 characters under a Home Screen icon before it cuts the name. */
const SHORT_NAME_MAX = 12;

/** The label under the icon: the whole name if it fits, else as many words as fit, else a cut. */
export function storeAppShortName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= SHORT_NAME_MAX) return trimmed;
  let out = "";
  for (const word of trimmed.split(/\s+/)) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > SHORT_NAME_MAX) break;
    out = next;
  }
  return out || trimmed.slice(0, SHORT_NAME_MAX);
}

/** The letter drawn on the icon when the store has no usable logo. */
export function storeInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "S";
}

export type StoreAppManifestInput = {
  slug: string;
  /** What buyers see: displayStoreName(), so a demo store says so. */
  name: string;
  theme: string | null | undefined;
};

/** The web app manifest for one store. Field types follow Next's MetadataRoute.Manifest. */
export function storeAppManifest({ slug, name, theme }: StoreAppManifestInput) {
  const path = storeAppPath(slug);
  const color = storeThemeHex(theme);
  return {
    id: path,
    name,
    short_name: storeAppShortName(name),
    description: `Order from ${name}.`,
    start_url: path,
    scope: path,
    display: "standalone" as const,
    theme_color: color,
    background_color: "#FFFFFF",
    icons: [
      { src: storeAppIconPath(slug, 192), sizes: "192x192", type: "image/png", purpose: "any" as const },
      { src: storeAppIconPath(slug, 512), sizes: "512x512", type: "image/png", purpose: "any" as const },
      // The icons keep the logo inside the centre 80%, so they also work cut to a circle.
      { src: storeAppIconPath(slug, 192), sizes: "192x192", type: "image/png", purpose: "maskable" as const },
      { src: storeAppIconPath(slug, 512), sizes: "512x512", type: "image/png", purpose: "maskable" as const },
    ],
  };
}

/** Per store and device: the buyer closed the "Add to Home Screen" card. */
export function storeInstallDismissKey(slug: string): string {
  return `awz_store_install_dismissed_v1:${slug}`;
}

/**
 * Chrome on Android from inside Instagram, WhatsApp or Facebook: an intent link
 * that reopens this page in Chrome, where it can be installed. iPhone has no
 * equivalent; the guide dialog walks the buyer out to Safari instead.
 */
export function openInChromeIntentUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

export const STORE_INSTALL_COPY = {
  title: (name: string) => `Add ${name} to your Home Screen`,
  body: "Open the store in one tap next time, like an app.",
  action: "Add to Home Screen",
  ios: "On iPhone: tap Share, then Add to Home Screen.",
  guide: "Show me how",
  inApp: "Open this page in Chrome or Safari to add it to your Home Screen.",
  openInChrome: "Open in Chrome",
  dismiss: "Close the Home Screen tip",
} as const;
