import { expect, test, type Locator } from "@playwright/test";

import { createMenuItem, createVendorSession } from "./helpers/vendor";

/**
 * Accessibility here is POS-critical, not decorative: the operator is standing
 * at a cart, one-handed, on a budget Android in daylight. The numbers below are
 * the ones .cursor/rules/accessibility.mdc commits to — 44x44 px minimum tap
 * targets, an 80x80 mic, and voice/cart state announced rather than only shown.
 */

const MIN_TAP = 44;
const MIN_MIC = 80;

async function expectTapTarget(locator: Locator, min: number, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should be laid out`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(min);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(min);
}

test.describe("POS accessibility", () => {
  test("the mic is 80x80 and announces its state to a screen reader", async ({ page, request }) => {
    await createVendorSession(page, request, "a11y-mic");
    await createMenuItem(page, { name: "Filter Coffee", priceInRupees: 20 });
    await page.goto("/pos");

    // VoiceOrderButton's aria-label is state-driven; "Start voice order" is idle.
    const mic = page.getByRole("button", { name: /start voice order/i });
    await expect(mic).toBeVisible();
    await expectTapTarget(mic, MIN_MIC, "mic button");

    // Voice state must be distinguishable beyond colour — aria-pressed carries
    // listening vs idle for anyone who cannot see the red pulse.
    await expect(mic).toHaveAttribute("aria-pressed", /true|false/);
  });

  test("the cart is a live region so added items are announced", async ({ page, request }) => {
    await createVendorSession(page, request, "a11y-cart");
    await createMenuItem(page, { name: "Vada Pav", priceInRupees: 25 });
    await page.goto("/pos");

    const cart = page.getByRole("region", { name: "Cart" });
    await expect(cart).toHaveAttribute("aria-live", "polite");

    await page.getByRole("button", { name: /^Vada Pav/ }).click();
    await expect(cart).toContainText("Vada Pav");
  });

  test("quick-add and cart quantity controls all meet 44x44", async ({ page, request }) => {
    await createVendorSession(page, request, "a11y-taps");
    await createMenuItem(page, { name: "Pani Puri", priceInRupees: 30 });
    await page.goto("/pos");

    const quickAdd = page.getByRole("button", { name: /^Pani Puri/ });
    await expectTapTarget(quickAdd, MIN_TAP, "quick-add tile");
    await quickAdd.click();

    for (const name of ["Increase Pani Puri", "Decrease Pani Puri", "Remove Pani Puri"]) {
      await expectTapTarget(page.getByRole("button", { name }), MIN_TAP, name);
    }
  });

  test("every voice-only path has a tap fallback", async ({ page, request }) => {
    await createVendorSession(page, request, "a11y-fallback");
    await createMenuItem(page, { name: "Bhel Puri", priceInRupees: 35 });
    await page.goto("/pos");

    // QuickAddGrid is the tap fallback. If it ever renders only behind a
    // "voice failed" state, a vendor without a working mic cannot sell at all.
    await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bhel Puri/ })).toBeVisible();
  });
});

test.describe("keyboard access on public pages", () => {
  for (const [path, linkName] of [
    ["/", /skip to main content/i],
    ["/pricing", /skip to main content/i],
  ] as const) {
    test(`${path} exposes a skip link as the first tab stop`, async ({ page }) => {
      await page.goto(path);
      await page.keyboard.press("Tab");

      const skip = page.getByRole("link", { name: linkName });
      await expect(skip).toBeFocused();
    });
  }

  test("the sign-in form is reachable and labelled", async ({ page }) => {
    await page.goto("/sign-in");
    // Labels, not placeholders — getByLabel failing here means a screen reader
    // announces an unnamed field.
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  // KNOWN FAILURE, deliberately not deleted.
  //
  // accessibility.mdc requires 44x44 for *any* tap target and globs **/*.tsx,
  // but the shared Button default is `h-10` (40 px), so every default-size
  // Button on the auth and marketing pages is 4 px short. The POS is unaffected
  // — its controls set `min-h-11` explicitly, which is why the other tests here
  // pass.
  //
  // Fixing it is a design-system call, not a test call: design-system.mdc says
  // never to modify the primitives in components/ui/, so it is either a global
  // default change (h-10 -> h-11, moves every button in the app) or `min-h-11`
  // on ~11 call sites. Un-skip this once that decision is made.
  test.fixme("auth page buttons meet the 44px minimum", async ({ page }) => {
    await page.goto("/sign-in");
    await expectTapTarget(
      page.getByRole("button", { name: /sign in/i }),
      MIN_TAP,
      "sign-in submit",
    );
  });
});
