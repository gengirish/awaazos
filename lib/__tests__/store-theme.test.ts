import { describe, expect, it } from "vitest";

import {
  DEFAULT_STORE_THEME,
  isStoreTheme,
  STORE_THEME_LABELS,
  STORE_THEMES,
  storeTheme,
  storeThemeAttribute,
} from "@/lib/store-theme";

describe("store theme", () => {
  it("accepts only the listed ids", () => {
    for (const id of STORE_THEMES) expect(isStoreTheme(id)).toBe(true);
    expect(isStoreTheme("pink")).toBe(false);
    expect(isStoreTheme("")).toBe(false);
    expect(isStoreTheme(null)).toBe(false);
    expect(isStoreTheme("GREEN")).toBe(false);
  });

  it("falls back to the default for an unknown or missing value", () => {
    expect(storeTheme(undefined)).toBe(DEFAULT_STORE_THEME);
    expect(storeTheme(null)).toBe(DEFAULT_STORE_THEME);
    expect(storeTheme("pink")).toBe(DEFAULT_STORE_THEME);
    expect(storeTheme("purple")).toBe("purple");
  });

  it("renders the default with no data-theme attribute and the rest with their id", () => {
    expect(storeThemeAttribute("orange")).toBeUndefined();
    expect(storeThemeAttribute(undefined)).toBeUndefined();
    expect(storeThemeAttribute("nonsense")).toBeUndefined();
    expect(storeThemeAttribute("green")).toBe("green");
    expect(storeThemeAttribute("blue")).toBe("blue");
  });

  it("has a label for every id", () => {
    for (const id of STORE_THEMES) expect(STORE_THEME_LABELS[id]).toMatch(/\S/);
  });
});
