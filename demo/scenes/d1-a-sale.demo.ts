import { expect, test } from "@playwright/test";

import { Director } from "../kit/director";
import { seedStore } from "../seed/kitchen";
import { sellerSignIn } from "../seed/session";

/**
 * D1 · A sale (docs/DEMO_VIDEOS_PLAN.md, section D).
 *
 * The seller makes "Diwali sale: 10% off everything" in Settings → Offers on
 * their phone, then opens their store: every price shows struck out next to
 * the sale price.
 *
 * Writes real rows: throwaway Postgres only (the global setup enforces it).
 */

test("D1 seller starts a Diwali sale and the store shows sale prices", async ({ page, browser, request }) => {
  const store = await seedStore(browser, request, "meals");
  await sellerSignIn(page, store, "/settings/offers");
  await Director.prepare(page);
  // The init script only applies from the next navigation.
  await page.goto("/settings/offers");
  await expect(page.getByRole("heading", { level: 1, name: "Offers" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const d = new Director(page, test.info(), {
    scene: "d1-a-sale",
    title: "A sale",
    accent: store.accent,
    lang: "en",
  });

  await d.start();
  await d.say("Festival coming up? Start a sale in a minute.");
  await d.tap(page.getByRole("button", { name: "New offer" }), { after: 0 });
  const form = page.getByRole("dialog", { name: "New offer" });
  await expect(form).toBeVisible();
  await d.beat(700);

  await d.say("Give it a name your buyers will see.", { wait: 400 });
  await d.type(form.getByLabel("Name"), "Diwali sale");
  await d.type(form.getByLabel(/short description/i), "10% off everything this week");

  await d.say("Every dish counts, from one plate up.", { wait: 600 });
  await d.reveal(form.getByLabel("Which items count"));
  await expect(form.getByLabel("Which items count")).toHaveValue("ALL");
  await d.beat(600);
  await d.type(form.getByLabel("Minimum quantity"), "1");
  await d.type(form.getByLabel("Discount (%)"), "10");

  await d.say("Save it, and it's live on your store.", { wait: 400 });
  await d.tap(form.getByRole("button", { name: "Create offer" }), { after: 0 });
  await expect(page.getByRole("switch", { name: "Diwali sale active" })).toHaveAttribute("aria-checked", "true");
  await d.beat(1400);
  await d.say("Switch it off any time with one tap.", { wait: 600 });
  await d.reveal(page.getByRole("switch", { name: "Diwali sale active" }));
  await d.beat(1000);

  // ── The store, as buyers see it ─────────────────────────────────────────
  await page.goto(`/s/${store.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await d.say("Your buyers see the sale right on your store.");
  await d.pan(380, 1800);
  await d.say("Old prices struck out, sale prices beside them.");
  await d.say("The bill takes the discount by itself.");
  await d.stop();
});
