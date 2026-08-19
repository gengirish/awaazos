import { expect, test } from "@playwright/test";

import { createVendorSession } from "./helpers/vendor";

type PlanGateBody = {
  error: string;
  code?: string;
  requiredPlan?: string;
  currentPlan?: string;
  feature?: string;
};

/**
 * A freshly registered vendor is on FREE, so every paid-tier feature must
 * refuse with a structured 402 the UI can turn into an upgrade CTA
 * (components/pos/ReceiptModal.tsx keys off `code === "plan_upgrade_required"`).
 */
test.describe("plan gates return structured 402s", () => {
  test("CSV export is PRO-only and refuses a FREE vendor", async ({ page, request }) => {
    await createVendorSession(page, request, "gate-csv");

    const res = await page.request.get(
      "/api/transactions/export?from=2026-01-01&to=2026-12-31",
    );
    expect(res.status()).toBe(402);

    const body = (await res.json()) as PlanGateBody;
    expect(body.code).toBe("plan_upgrade_required");
    expect(body.requiredPlan).toBe("PRO");
    expect(body.currentPlan).toBe("FREE");
    expect(body.feature).toBe("csv_export");
  });

  test("the plan gate fires before query validation", async ({ page, request }) => {
    await createVendorSession(page, request, "gate-csv-noparams");

    // No from/to at all — a FREE vendor must still see 402, not the 400 that a
    // PRO vendor would get for missing params. Order matters: leaking 400 here
    // would tell an un-entitled caller which params the endpoint wants.
    const res = await page.request.get("/api/transactions/export");
    expect(res.status()).toBe(402);
    expect(((await res.json()) as PlanGateBody).feature).toBe("csv_export");
  });

  test("WhatsApp receipt send is STARTER-only and refuses a FREE vendor", async ({
    page,
    request,
  }) => {
    await createVendorSession(page, request, "gate-wa");

    const res = await page.request.post("/api/receipts/send", {
      data: { transactionId: "does-not-matter-plan-gate-runs-first" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(402);

    const body = (await res.json()) as PlanGateBody;
    expect(body.code).toBe("plan_upgrade_required");
    expect(body.requiredPlan).toBe("STARTER");
    expect(body.currentPlan).toBe("FREE");
    expect(body.feature).toBe("whatsapp_receipts");
  });
});
