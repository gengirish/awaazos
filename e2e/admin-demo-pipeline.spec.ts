import { expect, test, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setPlatformRole } from "./helpers/billing-db";
import { createVendorSession } from "./helpers/vendor";

/** /admin/demo-stores: the Today queue (lib/demo-pipeline.ts). Needs DEMO_OWNER_EMAIL on the server. */
test.describe("admin demo-store pipeline", () => {
  test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

  const tag = Date.now().toString(36);

  async function build(page: Page, name: string, ref: string) {
    const res = await page.request.post("/api/admin/demo-stores", {
      data: {
        external_ref: `e2e-${tag}-${ref}`,
        profile: { name, area: `Area ${tag}`, display_phone: "+919876543210" },
        items: [{ name: "Cake", price_paise: 50000 }],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  test("sending from the queue moves the tile, and the queue clears with the keyboard alone", async ({
    page,
    request,
    context,
  }) => {
    // WhatsApp itself stays out of the test.
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "wa" }));
    const creds = await createVendorSession(page, request, "pipeline-admin");
    await setPlatformRole(creds.email, "ADMIN");
    await build(page, `Keyboard One ${tag}`, "one");
    await build(page, `Keyboard Two ${tag}`, "two");
    await build(page, `Keyboard Three ${tag}`, "three");

    await page.goto("/admin/demo-stores");
    const sentTile = page.locator("dl > div").filter({ hasText: "Invite sent" }).locator("dd");
    const before = Number(await sentTile.innerText());
    const left = page.getByText(/actions? left today/);
    const startLeft = Number((await left.innerText()).split(" ")[0]);

    const card = page.getByRole("article");
    await expect(card.getByRole("heading")).toBeFocused();

    // S opens WhatsApp in a new tab and records the send.
    const popup = context.waitForEvent("page");
    await page.keyboard.press("s");
    const tab = await popup;
    // Whichever store is first: other specs' stores may share the queue.
    await tab.waitForURL(/wa\.me\/(\d+)?\?text=/);
    await tab.close();
    await expect(sentTile).toHaveText(String(before + 1));
    await expect(left).toContainText(String(startLeft - 1));

    // U takes it back; the tile and the queue follow.
    await page.keyboard.press("u");
    await expect(sentTile).toHaveText(String(before));
    await expect(left).toContainText(String(startLeft));

    // J and K move without changing anything.
    const firstName = await card.getByRole("heading").innerText();
    await page.keyboard.press("j");
    await expect(card.getByRole("heading")).not.toHaveText(firstName);
    await page.keyboard.press("k");
    await expect(card.getByRole("heading")).toHaveText(firstName);

    // Typing in the message never triggers a shortcut.
    await page.getByLabel("Message").focus();
    await page.keyboard.type("z");
    await expect(left).toContainText(String(startLeft));
    await page.keyboard.press("Escape");

    // Clear everything: snooze with Z, archive with A, turn about. Each new card
    // takes the focus, so nothing but the keyboard is needed.
    for (let i = 0; i < startLeft; i++) {
      await expect(left).toContainText(String(startLeft - i));
      await expect(card.getByRole("heading")).toBeFocused();
      await page.keyboard.press(i % 2 ? "a" : "z");
    }
    await expect(page.getByText("Pipeline clear")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Today's actions done" })).toBeVisible();
  });
});
