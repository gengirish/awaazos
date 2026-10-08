import { expect, test, type Page, type Route } from "@playwright/test";

import { createMenuItem, createVendorSession, type MenuItemRow } from "./helpers/vendor";

/**
 * Voice drop builder on /drops/new. Speech capture and POST /api/ai/parse-drop
 * are both stubbed — no real STT provider or Anthropic call is ever made.
 *
 * Writes real rows (vendor, menu, a drop) — throwaway Postgres only (CLAUDE.md).
 */

const TRANSCRIPT = "parson ke liye 20 ragi laddu 150 rupaye, 15 thepla, pickup shaam 6 se 8 baje, order 4 baje tak";

/** IST calendar day `offset` days from now, as YYYY-MM-DD. */
function istYmd(offset: number): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

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

type Menu = { laddu: MenuItemRow; thepla: MenuItemRow; chakli: MenuItemRow };

async function setUpVendor(page: Page, request: Parameters<typeof createVendorSession>[1], label: string) {
  const suffix = Math.random().toString(36).slice(2, 7);
  await createVendorSession(page, request, label, "/menu");
  const menu: Menu = {
    laddu: await createMenuItem(page, { name: `Ragi Laddu ${suffix}`, priceInRupees: 120, category: "Sweets" }),
    thepla: await createMenuItem(page, { name: `Methi Thepla ${suffix}`, priceInRupees: 40, category: "Snacks" }),
    chakli: await createMenuItem(page, { name: `Rice Chakli ${suffix}`, priceInRupees: 80, category: "Snacks" }),
  };
  return { suffix, menu };
}

function draftFor(menu: Menu, suffix: string) {
  const day = istYmd(2);
  return {
    title: `Ragi specials ${suffix}`,
    date: day,
    fulfilmentMode: "PICKUP",
    fulfilmentStart: "18:00",
    fulfilmentEnd: "20:00",
    closesAtDate: day,
    closesAtTime: "16:00",
    items: [
      { menuItemId: menu.laddu.id, name: menu.laddu.name, priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 },
      { menuItemId: menu.thepla.id, name: menu.thepla.name, priceInPaise: 4_000, maxQty: 15, perOrderLimit: null, sortOrder: 1 },
    ],
    unmatched: [{ spokenName: "masala chaas", quantity: 10 }],
    warnings: ["You didn't say where to pick up — add pickup instructions if customers need them."],
    filled: ["title", "date", "fulfilmentMode", "fulfilmentStart", "fulfilmentEnd", "closesAtDate", "closesAtTime", "items"],
    model: "haiku",
  };
}

test.describe("voice drop builder", () => {
  test("speak a drop: fields fill with badges, undo restores, save creates the drop", async ({ page, request }) => {
    test.setTimeout(180_000);
    const { suffix, menu } = await setUpVendor(page, request, "voicedrop");
    const draft = draftFor(menu, suffix);

    await fakeSpeech(page, TRANSCRIPT);
    const parseBodies: unknown[] = [];
    await page.route("**/api/ai/parse-drop", async (route: Route) => {
      parseBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: draft }) });
    });

    await page.goto("/drops/new");
    const panel = page.getByRole("region", { name: "Fill this form by voice" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/For example:/)).toBeVisible();

    const mic = panel.getByRole("button", { name: "Speak your drop" });
    const box = await mic.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(80);
    expect(box?.height).toBeGreaterThanOrEqual(80);

    // Tap fallback untouched before voice: default delivery, nothing selected.
    await expect(page.getByRole("radio", { name: "Delivery" })).toHaveAttribute("aria-checked", "true");
    const titleBefore = await page.getByLabel("Title").inputValue();

    await mic.click();
    await expect(panel.getByText("Listening… tap stop when you're done.")).toBeVisible();
    await expect(mic).toHaveAttribute("aria-pressed", "true");

    const summary = panel.getByText("Filled 7 fields and 2 dishes — check and save");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(panel.getByText(`“${TRANSCRIPT}”`)).toBeVisible();
    expect(parseBodies).toEqual([{ transcript: TRANSCRIPT, lang: "en-IN", sttSource: "webspeech" }]);

    // ── Fields filled from the draft ──
    await expect(page.getByLabel("Title")).toHaveValue(draft.title);
    await expect(page.getByLabel("Cooking day")).toHaveValue(draft.date);
    await expect(page.getByRole("radio", { name: "Pickup" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("18:00");
    await expect(page.getByLabel("Until", { exact: true })).toHaveValue("20:00");
    await expect(page.getByLabel("Order cut-off date")).toHaveValue(draft.date);
    await expect(page.getByLabel("Order cut-off time")).toHaveValue("16:00");
    await expect(page.getByRole("checkbox", { name: new RegExp(menu.laddu.name) })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: new RegExp(menu.thepla.name) })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: new RegExp(menu.chakli.name) })).not.toBeChecked();
    const ladduRow = page.getByRole("listitem").filter({ hasText: menu.laddu.name });
    await expect(ladduRow.getByLabel("Price (₹)")).toHaveValue("150");
    await expect(ladduRow.getByLabel("How many can you make?")).toHaveValue("20");

    // ── "From voice" badges: title, day, mode, from, until, cut-off, 2 dishes ──
    await expect(page.getByText("From voice", { exact: true })).toHaveCount(8);
    await expect(ladduRow.getByText("From voice", { exact: true })).toBeVisible();

    // ── Warnings + unmatched ──
    await expect(panel.getByRole("listitem").filter({ hasText: "add pickup instructions" })).toBeVisible();
    const unmatched = panel.getByRole("list", { name: "Dishes not on your menu" });
    await expect(unmatched.getByText("masala chaas")).toBeVisible();
    const addLink = unmatched.getByRole("link", { name: /Add masala chaas to menu/ });
    await expect(addLink).toHaveAttribute("href", "/menu?add=masala%20chaas");
    await unmatched.getByRole("button", { name: "Remove masala chaas" }).click();
    await expect(panel.getByText("masala chaas")).toHaveCount(0);

    // Editing a voice field by hand drops its badge.
    await page.getByLabel("Until", { exact: true }).fill("20:30");
    await expect(page.getByText("From voice", { exact: true })).toHaveCount(7);

    // ── Undo restores the pre-voice form ──
    await panel.getByRole("button", { name: "Undo voice changes" }).click();
    await expect(panel.getByText("Voice changes undone.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(titleBefore);
    await expect(page.getByRole("radio", { name: "Delivery" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("checkbox", { name: new RegExp(menu.laddu.name) })).not.toBeChecked();
    await expect(page.getByText("From voice", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Undo voice changes" })).toHaveCount(0);

    // ── Speak again, then save with the existing button (voice never auto-saves) ──
    await mic.click();
    await expect(panel.getByText("Filled 7 fields and 2 dishes — check and save")).toBeVisible();
    expect(page.url()).toMatch(/\/drops\/new$/);

    await page.getByRole("button", { name: "Create drop" }).click();
    await page.waitForURL(/\/drops\/[^/]+\/edit$/, { timeout: 120_000 });
    const dropId = new URL(page.url()).pathname.split("/")[2];

    const res = await page.request.get(`/api/drops/${dropId}`);
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        title: string;
        date: string;
        fulfilmentMode: string;
        fulfilmentStartsAt: string;
        fulfilmentEndsAt: string;
        closesAt: string;
        items: { menuItemId: string; priceInPaise: number; maxQty: number | null; sortOrder: number }[];
      };
    };
    expect(data.title).toBe(draft.title);
    expect(data.date).toBe(draft.date);
    expect(data.fulfilmentMode).toBe("PICKUP");
    expect(data.fulfilmentStartsAt).toBe(`${draft.date}T12:30:00.000Z`); // 18:00 IST
    expect(data.fulfilmentEndsAt).toBe(`${draft.date}T14:30:00.000Z`); // 20:00 IST
    expect(data.closesAt).toBe(`${draft.date}T10:30:00.000Z`); // 16:00 IST
    expect(data.items.map((i) => [i.menuItemId, i.priceInPaise, i.maxQty, i.sortOrder])).toEqual([
      [menu.laddu.id, 15_000, 20, 0],
      [menu.thepla.id, 4_000, 15, 1],
    ]);

    // Edit page: the panel warns that voice replaces saved values.
    const editPanel = page.getByRole("region", { name: "Fill this form by voice" });
    await expect(editPanel.getByText(/Nothing is saved until you press Save changes/)).toBeVisible();
  });

  test("voice unavailable (503) points to the form, which still works", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { menu } = await setUpVendor(page, request, "voicedrop503");

    await fakeSpeech(page, TRANSCRIPT);
    await page.route("**/api/ai/parse-drop", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "voice_unavailable", fallback: "form" }),
      }),
    );

    await page.goto("/drops/new");
    const panel = page.getByRole("region", { name: "Fill this form by voice" });
    await panel.getByRole("button", { name: "Speak your drop" }).click();
    await expect(panel.getByRole("alert")).toHaveText("Voice isn't available right now — fill the form below.");
    await expect(page.getByText("From voice", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Undo voice changes" })).toHaveCount(0);

    // Tap fallback: the form is untouched and usable.
    await page.getByLabel("Title").fill("Typed by hand");
    await page.getByRole("checkbox", { name: new RegExp(menu.laddu.name) }).check();
    await expect(page.getByRole("checkbox", { name: new RegExp(menu.laddu.name) })).toBeChecked();
    await expect(panel.getByRole("button", { name: "Speak your drop" })).toBeEnabled();
  });

  test("server STT cascade exhausted (fallback quickadd) points to the form", async ({ page, request }) => {
    test.setTimeout(120_000);
    await setUpVendor(page, request, "voicedropstt");
    // A legacy Telugu vendor goes through MediaRecorder → /api/ai/transcribe.
    const patch = await page.request.patch("/api/vendor", { data: { voiceLang: "te-IN" } });
    expect(patch.status()).toBe(200);

    // Silent fake microphone so MediaRecorder runs without a device or permission prompt.
    await page.addInitScript(() => {
      const md = navigator.mediaDevices ?? ({} as MediaDevices);
      md.getUserMedia = async () => {
        const ctx = new AudioContext();
        return ctx.createMediaStreamDestination().stream;
      };
      Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
    });
    let parseCalls = 0;
    await page.route("**/api/ai/parse-drop", (route) => {
      parseCalls++;
      return route.fulfill({ status: 500, body: "{}" });
    });
    await page.route("**/api/ai/transcribe", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "all_providers_failed", fallback: "quickadd" }),
      }),
    );

    await page.goto("/drops/new");
    const panel = page.getByRole("region", { name: "Fill this form by voice" });
    await expect(panel.getByText("తెలుగు (Telugu)")).toBeVisible();
    const mic = panel.getByRole("button", { name: "Speak your drop" });
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await mic.click(); // stop recording → upload
    await expect(panel.getByRole("alert")).toHaveText("Voice isn't available right now — fill the form below.");
    expect(parseCalls).toBe(0);
  });
});
