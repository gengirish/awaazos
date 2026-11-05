import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CAN_SET_BILLING, setOrderPayment, setStaffRole } from "./helpers/billing-db";
import { createMenuItem, createVendorSession, openStoreForMenuOrders } from "./helpers/vendor";

/**
 * A Razorpay payment that needs the seller's answer, and cancelling a Razorpay-paid
 * order. Razorpay itself is never called: these stores have no Razorpay credentials,
 * so a refund is refused the way a refused refund is, and the state a real payment
 * would leave is set in the database (local only).
 */
test.describe("Razorpay payment issues on the orders board", () => {
  test.skip(!CAN_SET_BILLING, "sets order state in a local database");

  async function placeOrder(page: Page, request: APIRequestContext): Promise<{ id: string }> {
    const { slug } = await openStoreForMenuOrders(page);
    const item = await createMenuItem(page, { name: "Issue Poha", priceInRupees: 40 });
    const placed = await request.post(`/api/s/${slug}/menu-orders`, {
      data: {
        items: [{ menuItemId: item.id, qty: 1 }],
        customerName: "Issue Buyer",
        customerPhone: "+919848054321",
        fulfilmentType: "PICKUP",
        paymentMethod: "UPI",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(placed.status()).toBe(201);
    const board = (await (await page.request.get("/api/storefront-orders")).json()) as { data: { id: string }[] };
    return { id: board.data[0]!.id };
  }

  test("a payment on a cancelled order stays in Needs action until it is answered", async ({ page, request }) => {
    await createVendorSession(page, request, "pay-issue");
    const { id } = await placeOrder(page, request);
    await setOrderPayment(id, {
      fulfilmentStatus: "CANCELLED",
      paymentIssue: "paid_after_cancel",
      paymentIssuePaymentId: "pay_E2eIssue00001",
    });

    await page.goto("/orders");
    const notice = page.getByTestId("payment-issue");
    await expect(notice.getByText("Paid after you cancelled")).toBeVisible();
    await expect(notice.getByRole("button", { name: "Refund ₹40.00" })).toBeVisible();

    // No Razorpay on this store: the refund is refused, and says nothing moved.
    await notice.getByRole("button", { name: "Refund ₹40.00" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Refund ₹40.00" }).click();
    await expect(notice.getByRole("alert")).toContainText("No money has moved");

    await notice.getByRole("button", { name: "I'll refund from Razorpay" }).click();
    await expect(notice).toBeHidden();
    const board = (await (await page.request.get("/api/storefront-orders")).json()) as {
      data: { id: string; paymentIssue: string | null; bucket: string }[];
    };
    expect(board.data.find((o) => o.id === id)).toMatchObject({ paymentIssue: null, bucket: "closed" });
  });

  test("a refused refund keeps the order paid until the seller cancels anyway", async ({ page, request }) => {
    await createVendorSession(page, request, "pay-refund");
    const { id } = await placeOrder(page, request);
    await setOrderPayment(id, { paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED", razorpayPaymentId: "pay_E2eRefund0001" });

    await page.goto("/orders");
    await page.getByRole("tab", { name: /Confirmed/ }).click();
    await page.getByRole("button", { name: /Show details/ }).click();
    await page.getByRole("button", { name: "Cancel order" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This refunds them through Razorpay")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel and refund ₹40.00" }).click();
    await expect(dialog.getByRole("alert")).toContainText("No money has moved");

    type Board = { data: { id: string; paymentStatus: string; fulfilmentStatus: string }[] };
    let board = (await (await page.request.get("/api/storefront-orders")).json()) as Board;
    expect(board.data.find((o) => o.id === id)).toMatchObject({ paymentStatus: "PAID", fulfilmentStatus: "CONFIRMED" });

    await dialog.getByRole("button", { name: "Cancel anyway, I’ll refund from Razorpay" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => {
      board = (await (await page.request.get("/api/storefront-orders")).json()) as Board;
      return board.data.find((o) => o.id === id)?.fulfilmentStatus;
    }).toBe("CANCELLED");
  });

  test("a cashier reads what happened but can't send money back", async ({ page, request }) => {
    const creds = await createVendorSession(page, request, "pay-cashier");
    const { id } = await placeOrder(page, request);
    await setOrderPayment(id, {
      paymentStatus: "PAID",
      fulfilmentStatus: "CONFIRMED",
      razorpayPaymentId: "pay_E2eCashier001",
      paymentIssue: "paid_twice",
      paymentIssuePaymentId: "pay_E2eCashier002",
    });
    await setStaffRole(creds.email, "CASHIER");

    await page.goto("/orders");
    const notice = page.getByTestId("payment-issue");
    await expect(notice.getByText("Paid twice?")).toBeVisible();
    await expect(notice.getByText("Ask a manager or the owner")).toBeVisible();
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

    for (const data of [{ action: "cancel" }, { action: "refund_payment_issue" }, { action: "keep_payment_issue" }]) {
      const res = await page.request.patch(`/api/storefront-orders/${id}`, {
        data,
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status(), `${data.action} needs a manager`).toBe(403);
      expect(await res.json()).toEqual({ error: "manager_required" });
    }
  });
});
