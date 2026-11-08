import { expect, test } from "@playwright/test";

import { secondaryNav } from "./helpers/nav";
import { createVendorSession } from "./helpers/vendor";

/**
 * The in-app Help page (`/help`): reached from the shell, describes the
 * navigation the current viewport gets, and its "How do I…" list filters and
 * links into the app. Content rules are unit-tested in lib/__tests__/help-guide.test.ts.
 */
test.describe("help guide", () => {
  test("opens from the shell, searches and links to the right screen", async ({ page, request }) => {
    await createVendorSession(page, request, "help-guide", "/settings");

    await (await secondaryNav(page)).getByRole("link", { name: "Help", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();

    // Exactly one of the two "getting around" notes is on screen.
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    await expect(page.getByText("On your phone")).toBeVisible({ visible: phone });
    await expect(page.getByText("On a tablet or computer")).toBeVisible({ visible: !phone });

    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: /The counter./ })).toHaveAttribute("href", "/pos");

    // The order's whole life, in order: customer places it … the rider taps Delivered … finish.
    const journey = main.getByRole("region", { name: "An online order, start to finish" });
    await expect(journey.getByRole("listitem")).toHaveCount(7);
    await expect(journey.getByRole("listitem").first()).toContainText("Customer places the order");
    await expect(journey).toContainText("Rider delivers and taps Delivered");
    await expect(journey.getByRole("listitem").last()).toContainText("Finish the order");

    await page.getByLabel("Search help").fill("upi");
    const payments = main.getByRole("link", { name: /Set your UPI ID/ });
    await expect(payments).toBeVisible();
    await expect(main.getByRole("link", { name: /Find out how much to cook/ })).toHaveCount(0);
    // An owner is never told a setting is locked.
    await expect(main.getByText("Only the owner can change this.")).toHaveCount(0);

    const box = await payments.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.getByLabel("Search help").fill("zzzz");
    await expect(main.getByText(/Nothing matches/)).toBeVisible();

    await page.getByLabel("Search help").fill("upi");
    await payments.click();
    await expect(page).toHaveURL(/\/settings\/payments$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  });
});
