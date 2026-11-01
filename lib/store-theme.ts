/**
 * The store's colour (`VendorSettings.theme`): the accent of its public pages
 * (/s/[slug] and the order and account pages under it). Each id other than the
 * default has a `[data-theme=…]` block in app/globals.css that swaps `--primary`
 * and `--ring`; the default (`orange`, the column default) stays on the brand
 * primary and is rendered with no `data-theme` attribute at all. White text
 * passes 4.5:1 on every one (table in .cursor/rules/design-system.mdc).
 *
 * This is the one list: the picker in Settings → Online store, the
 * `PATCH /api/vendor` schema and the storefront pages all read it.
 */
export const STORE_THEMES = ["orange", "green", "amber", "red", "blue", "purple"] as const;

export type StoreTheme = (typeof STORE_THEMES)[number];

export const DEFAULT_STORE_THEME: StoreTheme = "orange";

/** What the picker calls each colour. */
export const STORE_THEME_LABELS: Record<StoreTheme, string> = {
  orange: "Saffron",
  green: "Green",
  amber: "Amber",
  red: "Red",
  blue: "Blue",
  purple: "Purple",
};

export function isStoreTheme(value: unknown): value is StoreTheme {
  return typeof value === "string" && (STORE_THEMES as readonly string[]).includes(value);
}

/** The stored value as a theme; anything unknown (or missing) is the default. */
export function storeTheme(raw: string | null | undefined): StoreTheme {
  return isStoreTheme(raw) ? raw : DEFAULT_STORE_THEME;
}

/**
 * The `data-theme` attribute for a page or swatch: the theme id, or `undefined`
 * for the default so the brand primary from `:root` applies untouched.
 */
export function storeThemeAttribute(raw: string | null | undefined): Exclude<StoreTheme, "orange"> | undefined {
  const theme = storeTheme(raw);
  return theme === "orange" ? undefined : theme;
}
