import { expect, test } from "@playwright/test";

import { secondaryNav } from "./helpers/nav";
import { createVendorSession } from "./helpers/vendor";

/**
 * The in-app Help page (`/help`): reached from the shell, opens short (groups,
 * topics, journey steps and "Getting around" are closed until tapped), searches
 * and links into the app. Content rules are unit-tested in lib/__tests__/help-guide.test.ts.
 */
test.describe("help guide", () => {
  test("opens short, searches and links to the right screen", async ({ page, request }) => {
    await createVendorSession(page, request, "help-guide", "/settings");

    await (await secondaryNav(page)).getByRole("link", { name: "Help", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    const main = page.getByRole("main");

    // Closed until tapped: no answer text, a group row with its count.
    const counter = main.locator("summary", { hasText: "Selling at the counter" });
    await expect(counter).toContainText(/\d+ questions/);
    await expect(main.getByText("Tap dishes under Quick add")).toBeHidden();
    await counter.click();
    const ringUp = main.locator("summary", { hasText: "Ring up a sale" });
    await expect(ringUp).toBeVisible();
    const summaryBox = await ringUp.boundingBox();
    expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
    await ringUp.click();
    await expect(main.getByText(/Tap dishes under Quick add/)).toBeVisible();
    await expect(main.getByRole("link", { name: /^Go to Sell/ })).toHaveAttribute("href", "/pos");

    // Exactly one of the two "getting around" notes is on screen, once opened.
    await main.locator("summary", { hasText: "Where each screen is" }).click();
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    await expect(page.getByText("On your phone")).toBeVisible({ visible: phone });
    await expect(page.getByText("On a tablet or computer")).toBeVisible({ visible: !phone });
    await expect(main.getByRole("link", { name: /The counter./ })).toHaveAttribute("href", "/pos");

    // The order's whole life, in order: customer places it … the rider taps Delivered … finish.
    const journey = main.getByRole("region", { name: "An online order, start to finish" });
    await expect(journey.getByRole("listitem")).toHaveCount(8);
    await expect(journey).toContainText("Mark it ready");
    await expect(journey.getByRole("listitem").first()).toContainText("Customer places the order");
    await expect(journey).toContainText("Rider delivers and taps Delivered");
    await expect(journey.getByRole("listitem").last()).toContainText("Finish the order");

    // A search opens every match, answers included.
    await page.getByLabel("Search help").fill("upi");
    const payments = main.getByRole("link", { name: /^Go to (More › )?Settings › Payments/ });
    await expect(main.getByText("Set your UPI ID", { exact: false }).first()).toBeVisible();
    await expect(payments.first()).toBeVisible();
    await expect(main.getByText("Find out how much to cook")).toHaveCount(0);
    // An owner is never told a setting is locked.
    await expect(main.getByText("Only the owner can change this.")).toHaveCount(0);

    const box = await payments.first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.getByLabel("Search help").fill("zzzz");
    await expect(main.getByText(/Nothing matches/)).toBeVisible();

    await page.getByLabel("Search help").fill("upi");
    await payments.first().click();
    await expect(page).toHaveURL(/\/settings\/payments$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  });

  // Films are offered once HELP_VIDEO_BASE_URL names their folder (CI sets a site path
  // with no files in it: this checks the buttons and the sheet, not playback).
  test("films sit in a row at the top and open in a sheet, loaded only on the tap", async ({ page, request }) => {
    test.skip(!process.env.HELP_VIDEO_BASE_URL, "HELP_VIDEO_BASE_URL is not set for this server");
    await createVendorSession(page, request, "help-videos", "/help");

    const main = page.getByRole("main");
    await expect(main.locator("video")).toHaveCount(0);

    const row = main.getByRole("region", { name: "Watch how it works" });
    const card = row.getByRole("button", { name: /^Watch: Ring up a sale and take cash/ });
    await expect(card).toBeVisible();
    // The row steps aside while searching.
    await page.getByLabel("Search help").fill("receipt");
    await expect(row).toBeHidden();
    await page.getByLabel("Search help").fill("");
    await expect(row).toBeVisible();

    // The journey's first step has the buyer's film, inside the step.
    const journey = main.getByRole("region", { name: "An online order, start to finish" });
    await journey.locator("summary", { hasText: "Customer places the order" }).click();
    await expect(journey.getByRole("button", { name: /^Watch: How a customer orders/ })).toBeVisible();

    await card.click();
    const sheet = page.getByRole("dialog", { name: "Ring up a sale and take cash" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("video")).toHaveAttribute("src", /\/f3-tap-billing-cash\.mp4$/);
    await sheet.getByText("What the video says").click();
    await expect(sheet).toContainText("Tap the note they hand you, and see the change to give back.");

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.locator("video")).toHaveCount(0);
  });
});
