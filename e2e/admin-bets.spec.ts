import { expect, test } from "@playwright/test";

import { CAN_SET_BILLING, setPlatformRole } from "./helpers/billing-db";
import { createVendorSession } from "./helpers/vendor";

/**
 * /admin/bets (docs/admin-redesign/PHASE-4.md): the bet and marker routes are
 * platform-ADMIN only and answer 404 to anyone else; an ADMIN adds, decides and
 * deletes a bet through the page, and adds and deletes a timeline marker.
 */

const BET = {
  title: "E2E bet",
  hypothesis: "Paid bills reach 5 a week.",
  metricKey: "paid_bills_7d",
  targetValue: 5,
  comparator: "GTE",
  deadline: "2026-12-31",
};

test("a store owner with no platform role gets 404 from every bet and marker route", async ({ page, request }) => {
  await createVendorSession(page, request, "bets-user");
  const api = page.request;
  expect((await api.post("/api/admin/bets", { data: BET })).status()).toBe(404);
  expect((await api.patch("/api/admin/bets/seed_bet_voice_billing", { data: BET })).status()).toBe(404);
  expect((await api.delete("/api/admin/bets/seed_bet_voice_billing")).status()).toBe(404);
  expect(
    (await api.post("/api/admin/timeline-markers", { data: { kind: "EVENT", label: "x", occurredOn: "2026-11-01" } })).status(),
  ).toBe(404);
  expect((await api.delete("/api/admin/timeline-markers/nope")).status()).toBe(404);
});

test.describe("as a platform ADMIN", () => {
  test.skip(!CAN_SET_BILLING, "needs a local throwaway database to set a platform role");

  test("validates input, answers in the checked shape and 404s an unknown id", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "bets-api");
    await setPlatformRole(creds.email, "ADMIN");
    const api = page.request;

    const bad = await api.post("/api/admin/bets", { data: { ...BET, metricKey: "voice_share", targetValue: 12_000 } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).issues[0].message).toBe("A share can't be over 100%");

    const created = await api.post("/api/admin/bets", { data: BET });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string; deadline: string; decision: string } };
    expect(data).toMatchObject({ deadline: "2026-12-31", decision: "PENDING" });

    const decided = await api.patch(`/api/admin/bets/${data.id}`, { data: { ...BET, decision: "KILL" } });
    expect((await decided.json()).data.decision).toBe("KILL");

    expect((await api.patch("/api/admin/bets/nope", { data: BET })).status()).toBe(404);
    expect((await api.delete(`/api/admin/bets/${data.id}`)).status()).toBe(200);
    expect((await api.delete(`/api/admin/bets/${data.id}`)).status()).toBe(404);
  });

  test("adds a bet and a marker on the page, then deletes them", async ({ page, request }) => {
    test.slow();
    const creds = await createVendorSession(page, request, "bets-ui");
    await setPlatformRole(creds.email, "ADMIN");
    await page.goto("/admin/bets");
    await expect(page.getByRole("heading", { level: 1, name: "Bets and timeline" })).toBeVisible();

    const title = `UI bet ${Date.now()}`;
    await page.getByText("Add a bet", { exact: true }).click();
    const form = page.locator("details", { hasText: "Add a bet" }).last();
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Hypothesis, and what happens if it fails").fill("Sellers come back weekly.");
    await form.getByLabel("Target value").fill("3");
    await form.getByLabel("Deadline (the last day counts)").fill("2026-12-31");
    await form.getByRole("button", { name: "Add bet" }).click();

    const card = page.locator("li", { has: page.getByRole("heading", { name: title }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Decision pending");

    await card.getByText("Edit or decide").click();
    await card.getByRole("radio", { name: "Keep" }).check();
    await card.getByRole("button", { name: "Save bet" }).click();
    await expect(card).toContainText("Decided: keep");

    await card.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete bet" }).click();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);

    const label = `E2E market ${Date.now()}`;
    await page.getByText("Add a marker", { exact: true }).click();
    const markerForm = page.locator("details", { hasText: "Add a marker" }).last();
    await markerForm.getByRole("radio", { name: "Event" }).check();
    await markerForm.getByLabel("What happened").fill(label);
    // Yesterday in IST is always on the timeline (today is not).
    const yesterday = new Date(Date.now() + 5.5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
    await markerForm.getByLabel("Day").fill(yesterday);
    await markerForm.getByRole("button", { name: "Add marker" }).click();

    const row = page.locator("ol li", { hasText: label });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete marker" }).click();
    await expect(page.locator("ol li", { hasText: label })).toHaveCount(0);
  });
});
