import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import { createMenuItem, createVendorSession, registerVendor, signIn, type MenuItemRow } from "./helpers/vendor";

/**
 * Voice menu builder on /menu. Speech capture and POST /api/ai/parse-menu are
 * stubbed — no real STT provider or Anthropic call is ever made. POST
 * /api/menu/bulk hits the real server.
 *
 * Writes real rows (vendors, menu items) — throwaway Postgres only (CLAUDE.md).
 */

const TRANSCRIPT =
  "Masala chai 15 rupaye, cutting chai 10, samosa, vada pav 22 — snacks mein. Mango lassi 60, drinks.";

/** Fake Web Speech: start() "hears" `text` as one final phrase, then ends. */
async function fakeSpeech(page: Page, text: string) {
  await page.addInitScript((heard: string) => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onend: ((ev: unknown) => void) | null = null;
      private ended = false;
      start() {
        setTimeout(() => {
          if (this.ended) return;
          const phrase = Object.assign([{ transcript: heard, confidence: 0.9 }], { isFinal: true });
          this.onresult?.({ results: [phrase], resultIndex: 0 });
          setTimeout(() => this.finish(), 100);
        }, 700);
      }
      stop() {
        this.finish();
      }
      abort() {
        this.onerror?.({ error: "aborted" });
        this.finish();
      }
      private finish() {
        if (this.ended) return;
        this.ended = true;
        this.onend?.(new Event("end"));
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  }, text);
}

type DraftItem = {
  key: string;
  name: string;
  priceInPaise: number;
  category: string;
  emoji: string;
  aliases: string[];
  action: "create" | "update_price" | "unchanged";
  existingMenuItemId: string | null;
  existingPriceInPaise: number | null;
  priceSpoken: boolean;
  matchedFuzzy?: boolean;
};

function newItem(name: string, priceInPaise: number, category: string, emoji = "🍽️"): DraftItem {
  return {
    key: `new:${name.toLowerCase()}`,
    name,
    priceInPaise,
    category,
    emoji,
    aliases: [],
    action: "create",
    existingMenuItemId: null,
    existingPriceInPaise: null,
    priceSpoken: priceInPaise > 0,
  };
}

function existing(row: MenuItemRow, action: "update_price" | "unchanged", priceInPaise: number): DraftItem {
  return {
    key: `existing:${row.id}`,
    name: row.name,
    priceInPaise,
    category: "Snacks",
    emoji: "🍔",
    aliases: [],
    action,
    existingMenuItemId: row.id,
    existingPriceInPaise: row.priceInPaise,
    priceSpoken: true,
  };
}

function ok(draft: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify({ data: draft }) };
}

type MenuRow = MenuItemRow & { category: string; emoji: string };

async function menuByName(page: Page): Promise<Map<string, MenuRow>> {
  const res = await page.request.get("/api/menu");
  expect(res.status()).toBe(200);
  const { data } = (await res.json()) as { data: MenuRow[] };
  return new Map(data.map((r) => [r.name, r]));
}

test.describe("voice menu builder", () => {
  test("empty menu → speak → review (price needed, update, unchanged) → speak again → save", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = Math.random().toString(36).slice(2, 7);
    await fakeSpeech(page, TRANSCRIPT);
    await createVendorSession(page, request, "voicemenu", "/menu");

    // ── A brand-new vendor's empty menu opens the panel expanded ──
    await page.goto("/menu");
    const panel = page.getByRole("region", { name: "Add dishes by voice" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/For example:/)).toBeVisible();
    const mic = panel.getByRole("button", { name: "Speak your dishes" });
    const box = await mic.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(80);
    expect(box?.height).toBeGreaterThanOrEqual(80);
    // Tap fallback is right there too.
    await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeVisible();

    // ── Seed two dishes: the panel collapses into a button once the menu has items ──
    const vada = await createMenuItem(page, { name: `Vada Pav ${s}`, priceInRupees: 20, category: "Snacks" });
    const cutting = await createMenuItem(page, { name: `Cutting Chai ${s}`, priceInRupees: 10, category: "Beverages" });
    const kesar = await createMenuItem(page, { name: `Kesar Chai ${s}`, priceInRupees: 30, category: "Beverages" });

    const takes = [
      {
        items: [
          newItem(`Masala Chai ${s}`, 1_500, "Beverages", "☕"),
          newItem(`Samosa ${s}`, 0, "Snacks"),
          existing(vada, "update_price", 2_200),
          existing(cutting, "unchanged", 1_000),
          newItem(`Mango Lassi ${s}`, 6_000, "Drinks"),
          // "kesar wali chai 35" matched Kesar Chai by alias, not by its exact name.
          { ...existing(kesar, "update_price", 3_500), matchedFuzzy: true },
        ],
        warnings: ["You didn't say a price for samosa — add it before saving."],
        unparsed: ["aur kuch bhi"],
        model: "haiku",
      },
      {
        // Second take: masala chai again at a new price (de-duplicated), plus poha.
        items: [newItem(`masala chai ${s}`, 1_800, "Beverages", "☕"), newItem(`Poha ${s}`, 3_000, "Snacks")],
        warnings: [],
        unparsed: [],
        model: "haiku",
      },
    ];
    const parseBodies: unknown[] = [];
    await page.route("**/api/ai/parse-menu", async (route: Route) => {
      parseBodies.push(route.request().postDataJSON());
      await route.fulfill(ok(takes[Math.min(parseBodies.length - 1, takes.length - 1)]));
    });

    await page.goto("/menu");
    await expect(page.getByRole("region", { name: "Add dishes by voice" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add dishes by voice" }).click();
    await expect(panel).toBeVisible();

    // ── Speak ──
    await mic.click();
    await expect(panel.getByText("Listening… tap stop when you're done.")).toBeVisible();
    await expect(mic).toHaveAttribute("aria-pressed", "true");

    const heading = panel.getByRole("heading", { name: "Check your dishes" });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(panel.getByText(`“${TRANSCRIPT}”`)).toBeVisible();
    expect(parseBodies).toEqual([{ transcript: TRANSCRIPT, lang: "en-IN" }]);

    const rows = panel.getByRole("list", { name: "Dishes heard" });
    const dish = (n: number) => rows.getByRole("group", { name: `Dish ${n}`, exact: true });
    await expect(rows.getByRole("listitem")).toHaveCount(6);

    // Dish 1: plain create.
    await expect(dish(1).getByLabel("Name", { exact: true })).toHaveValue(`Masala Chai ${s}`);
    await expect(dish(1).getByLabel("Price (₹)")).toHaveValue("15");
    await expect(dish(1).getByRole("checkbox", { name: `Include Masala Chai ${s}` })).toBeChecked();

    // Dish 2: no price heard → "Price needed".
    await expect(dish(2).getByText("Price needed")).toBeVisible();
    await expect(dish(2).getByLabel("Price (₹)")).toHaveValue("");

    // Dish 3: existing dish, price update.
    await expect(dish(3).getByText("Update price ₹20 → ₹22")).toBeVisible();
    await expect(dish(3).getByLabel("Price (₹)")).toHaveValue("22");

    // Dish 4: already on the menu at that price — shown, but unchecked and disabled.
    await expect(dish(4).getByText("Already on your menu at ₹10")).toBeVisible();
    const cuttingBox = dish(4).getByRole("checkbox", { name: `Include Cutting Chai ${s}` });
    await expect(cuttingBox).not.toBeChecked();
    await expect(cuttingBox).toBeDisabled();

    // Dish 6: matched by alias — asks, and the price change starts unticked.
    await expect(dish(6).getByText(`Matched to Kesar Chai ${s} on your menu — is that right?`)).toBeVisible();
    await expect(dish(6).getByRole("checkbox", { name: `Include Kesar Chai ${s}` })).not.toBeChecked();
    await expect(dish(6).getByText("Update price ₹30 → ₹35")).toBeVisible();

    await expect(panel.getByRole("list", { name: "Things to check" })).toContainText("price for samosa");
    await expect(panel.getByRole("list", { name: "Parts we couldn't use" })).toContainText("aur kuch bhi");

    const save = panel.getByRole("button", { name: "Add 3, update 1" });
    await expect(save).toBeVisible();

    // ── Speak again: appends Poha, replaces Masala Chai's price in place ──
    await panel.getByRole("button", { name: "Speak again" }).click();
    await expect(panel.getByRole("button", { name: "Add 4, update 1" })).toBeVisible();
    await expect(rows.getByRole("listitem")).toHaveCount(7);
    await expect(dish(1).getByLabel("Price (₹)")).toHaveValue("18");
    await expect(dish(7).getByLabel("Name", { exact: true })).toHaveValue(`Poha ${s}`);

    // Unticking a row updates the live count; re-tick it.
    const pohaBox = dish(7).getByRole("checkbox", { name: `Include Poha ${s}` });
    await pohaBox.uncheck();
    await expect(panel.getByRole("button", { name: "Add 3, update 1" })).toBeVisible();
    await pohaBox.check();

    // "No, add as a new dish": the alias match becomes a create row named by the vendor.
    await dish(6).getByRole("button", { name: "No, add as a new dish" }).click();
    const kesarName = dish(6).getByLabel("Name", { exact: true });
    await expect(kesarName).toBeFocused();
    await expect(kesarName).toHaveValue(`Kesar Chai ${s}`);
    await kesarName.fill(`Kesar Chai Large ${s}`);
    await expect(dish(6).getByText(/Matched to/)).toHaveCount(0);
    await expect(dish(6).getByLabel("Price (₹)")).toHaveValue("35");
    const saveAll = panel.getByRole("button", { name: "Add 5, update 1" });
    await expect(saveAll).toBeVisible();

    // ── Saving is blocked until the missing price is filled ──
    let bulkCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/menu/bulk")) bulkCalls++;
    });
    await saveAll.click();
    const samosaPrice = dish(2).getByLabel("Price (₹)");
    await expect(samosaPrice).toHaveAttribute("aria-invalid", "true");
    await expect(samosaPrice).toBeFocused();
    await expect(dish(2).getByText("Price needed", { exact: true })).toHaveCount(2); // badge + inline error
    expect(bulkCalls).toBe(0);

    await samosaPrice.fill("20");
    await expect(samosaPrice).not.toHaveAttribute("aria-invalid", "true");
    await expect(dish(2).getByText("Price needed")).toHaveCount(0);

    // ── Edit a name, a category and an emoji ──
    await dish(5).getByLabel("Name", { exact: true }).fill(`Mango Lassi Large ${s}`);
    const cat = dish(5).getByLabel("Category");
    await cat.fill("Beverages");
    await dish(5).getByRole("button", { name: /^Emoji for Mango Lassi Large/ }).click();
    await dish(5).getByRole("button", { name: "Select emoji 🥗" }).click();

    // ── Save ──
    const bulkReq = page.waitForRequest((r: Request) => r.url().includes("/api/menu/bulk") && r.method() === "POST");
    await saveAll.click();
    const sent = await bulkReq;
    expect(sent.headers()["idempotency-key"]).toBeTruthy();
    const sentBody = sent.postDataJSON() as { items: { name: string; priceInPaise: number; existingMenuItemId?: string }[] };
    expect(sentBody.items.map((i) => [i.name, i.priceInPaise, i.existingMenuItemId ?? null])).toEqual([
      [`Masala Chai ${s}`, 1_800, null],
      [`Samosa ${s}`, 2_000, null],
      [`Vada Pav ${s}`, 2_200, vada.id],
      [`Mango Lassi Large ${s}`, 6_000, null],
      [`Kesar Chai Large ${s}`, 3_500, null],
      [`Poha ${s}`, 3_000, null],
    ]);

    const summary = panel.getByRole("status").filter({ hasText: "Added 5 dishes, updated 1 price" });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(panel.getByRole("heading", { name: "Check your dishes" })).toHaveCount(0);

    // ── The menu list shows the new dishes and the updated price ──
    const grid = page.locator("#main-menu");
    for (const name of [`Masala Chai ${s}`, `Samosa ${s}`, `Mango Lassi Large ${s}`, `Kesar Chai Large ${s}`, `Poha ${s}`]) {
      await expect(grid.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const menu = await menuByName(page);
    expect(menu.get(`Masala Chai ${s}`)).toMatchObject({ priceInPaise: 1_800, category: "Beverages", emoji: "☕" });
    expect(menu.get(`Samosa ${s}`)).toMatchObject({ priceInPaise: 2_000, category: "Snacks" });
    expect(menu.get(`Mango Lassi Large ${s}`)).toMatchObject({ priceInPaise: 6_000, category: "Beverages", emoji: "🥗" });
    expect(menu.get(`Poha ${s}`)).toMatchObject({ priceInPaise: 3_000 });
    expect(menu.get(`Vada Pav ${s}`)?.priceInPaise).toBe(2_200);
    expect(menu.get(`Cutting Chai ${s}`)?.priceInPaise).toBe(1_000);
    expect(menu.get(`Kesar Chai Large ${s}`)?.priceInPaise).toBe(3_500);
    expect(menu.get(`Kesar Chai ${s}`)?.priceInPaise).toBe(3_000); // the alias match was not touched
    expect(menu.size).toBe(8); // 3 seeded + 5 added
    await expect(grid.getByText("₹22.00").first()).toBeVisible();
  });

  test("voice unavailable (503) points to Add item, which still works", async ({ page, request }) => {
    test.setTimeout(120_000);
    await fakeSpeech(page, TRANSCRIPT);
    await createVendorSession(page, request, "voicemenu503", "/menu");
    await page.route("**/api/ai/parse-menu", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "voice_unavailable", fallback: "form" }),
      }),
    );

    await page.goto("/menu");
    const panel = page.getByRole("region", { name: "Add dishes by voice" });
    await panel.getByRole("button", { name: "Speak your dishes" }).click();
    await expect(panel.getByRole("alert")).toHaveText("Voice isn't available right now — use “Add item” below.");
    await expect(panel.getByRole("heading", { name: "Check your dishes" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Speak your dishes" })).toBeEnabled();

    // Tap fallback: the add form opens.
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add menu item" })).toBeVisible();
  });

  test("onboarding: 'Speak your whole menu' lands on the menu with the voice panel open", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const creds = await registerVendor(request, "voicemenuonb");
    await signIn(page, creds, "/onboarding");
    await expect(page.getByRole("heading", { name: "Set up your store" })).toBeVisible();

    await page.getByLabel("City").fill("Hyderabad");
    await page.getByLabel("State").fill("Telangana");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("UPI ID (optional)").fill("e2evoice@okaxis");
    await page.getByLabel("Name shown on UPI screen").fill("E2E Voice Stall");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "What you sell" })).toBeVisible();
    await page.getByRole("button", { name: "Speak your whole menu" }).click();
    await expect(page.getByText(/land on your Menu with the mic ready/)).toBeVisible();
    // No typed items needed in this mode.
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await page.getByLabel("WhatsApp number (optional)").fill("+919876543210");
    await page.getByRole("button", { name: "Finish & speak your menu" }).click();

    await page.waitForURL(/\/menu\?voice=1$/, { timeout: 60_000 });
    const panel = page.getByRole("region", { name: "Add dishes by voice" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Speak your dishes" })).toBeVisible();
    const menu = await menuByName(page);
    expect(menu.size).toBe(0);
  });
});
