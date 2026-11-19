import { expect, test } from "@playwright/test";

/**
 * Pain-point Reels (lib/pain-reels.ts): the landing page's "Sound familiar?" row and
 * each Reel's own page. CI sets PAIN_REEL_BASE_URL=/pain-reels, a folder with no files
 * in it, so this checks the pages and links, not playback.
 */
test.describe("pain-point reels", () => {
  test("landing row links to a Reel's page, which plays it and offers sign-up", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#sound-familiar");
    await expect(section.getByRole("heading", { name: "Sound familiar?" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Home kitchens" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Jewellery and other products" })).toBeVisible();

    await section.locator('a[href="/v/orders_scattered"]').click();
    await expect(page).toHaveURL(/\/v\/orders_scattered$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DMs mein orders kho jaate hain?");

    const video = page.locator("video");
    await expect(video).toHaveAttribute("src", "/pain-reels/orders_scattered.mp4");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(page.getByRole("link", { name: /start/i }).first()).toHaveAttribute("href", "/sign-up");
    await expect(page.locator('meta[property="og:video"]')).toHaveAttribute("content", /orders_scattered\.mp4$/);
  });

  test("is public: a signed-out visitor is not sent to sign-in", async ({ page }) => {
    const res = await page.goto("/v/jewellery-overselling");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/v\/jewellery-overselling$/);
  });

  test("an unknown Reel is a 404", async ({ page }) => {
    const res = await page.goto("/v/not-a-reel");
    expect(res?.status()).toBe(404);
  });
});
