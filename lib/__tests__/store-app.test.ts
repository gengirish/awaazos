import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hslToHex,
  isStoreAppIconSize,
  openInChromeIntentUrl,
  STORE_THEME_HSL,
  storeAppManifest,
  storeAppShortName,
  storeInitial,
  storeInstallDismissKey,
  storeManifestPath,
  storeThemeHex,
} from "@/lib/store-app";
import { STORE_THEMES } from "@/lib/store-theme";

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

/** `--primary` of a theme block, or of `:root` for the default. */
function cssPrimary(theme: string): string {
  const block =
    theme === "orange"
      ? css.slice(css.indexOf(":root"))
      : css.slice(css.indexOf(`[data-theme="${theme}"]`));
  const match = /--primary:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(block);
  if (!match) throw new Error(`no --primary for ${theme}`);
  return `${match[1]} ${match[2]} ${match[3]}`;
}

describe("store theme colours", () => {
  it.each(STORE_THEMES)("%s matches app/globals.css", (theme) => {
    expect(STORE_THEME_HSL[theme].join(" ")).toBe(cssPrimary(theme));
  });

  it("converts HSL to hex", () => {
    expect(hslToHex([0, 0, 100])).toBe("#ffffff");
    expect(hslToHex([0, 100, 50])).toBe("#ff0000");
    expect(hslToHex([25, 100, 37])).toBe("#bd4f00");
  });

  it("falls back to the default colour for an unknown theme", () => {
    expect(storeThemeHex("teal")).toBe(storeThemeHex("orange"));
    expect(storeThemeHex(null)).toBe("#bd4f00");
  });
});

describe("storeAppManifest", () => {
  const manifest = storeAppManifest({ slug: "sam-store", name: "Sam's Home Bakes", theme: "green" });

  it("is the store's own app, not the seller app", () => {
    expect(manifest.id).toBe("/s/sam-store");
    expect(manifest.start_url).toBe("/s/sam-store");
    expect(manifest.scope).toBe("/s/sam-store");
    expect(manifest.name).toBe("Sam's Home Bakes");
    expect(manifest).not.toHaveProperty("shortcuts");
  });

  it("keeps the start page and the order pages inside the scope", () => {
    for (const page of [manifest.start_url, "/s/sam-store/o/abc", "/s/sam-store/account"]) {
      expect(page.startsWith(manifest.scope)).toBe(true);
    }
  });

  it("uses the store's colour and icons", () => {
    expect(manifest.theme_color).toBe(storeThemeHex("green"));
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/s/sam-store/app-icon/")).toBe(true);
      expect(isStoreAppIconSize(Number(icon.src.split("/").pop()))).toBe(true);
    }
  });
});

describe("storeAppShortName", () => {
  it("keeps a short name whole", () => {
    expect(storeAppShortName("Sam Store")).toBe("Sam Store");
  });

  it("keeps whole words when the name is long", () => {
    expect(storeAppShortName("Sam's Home Bakes Kondapur")).toBe("Sam's Home");
  });

  it("cuts a single long word", () => {
    expect(storeAppShortName("Supercalifragilistic")).toBe("Supercalifra");
  });
});

describe("storeInitial", () => {
  it("is the first letter, upper case", () => {
    expect(storeInitial("  sam store")).toBe("S");
    expect(storeInitial("")).toBe("S");
  });
});

describe("openInChromeIntentUrl", () => {
  it("reopens the same page in Chrome", () => {
    expect(openInChromeIntentUrl("https://awaazos.intelliforge.tech/s/sam-store?src=ig#menu")).toBe(
      "intent://awaazos.intelliforge.tech/s/sam-store?src=ig#Intent;scheme=https;package=com.android.chrome;end",
    );
  });

  it("refuses anything but https", () => {
    expect(openInChromeIntentUrl("http://localhost:3000/s/x")).toBeNull();
    expect(openInChromeIntentUrl("not a url")).toBeNull();
  });
});

describe("paths and keys", () => {
  it("are per store", () => {
    expect(storeManifestPath("a")).toBe("/s/a/manifest.webmanifest");
    expect(storeInstallDismissKey("a")).not.toBe(storeInstallDismissKey("b"));
  });
});
