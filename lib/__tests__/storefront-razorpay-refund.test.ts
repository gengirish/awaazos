import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RazorpayRefundError, refundPaymentViaRazorpay, type RazorpayCreds } from "@/lib/storefront-razorpay";

const keys: RazorpayCreds = { kind: "keys", keyId: "rzp_test_UnitTest1234", keySecret: "secret" };
const oauth: RazorpayCreds = { kind: "oauth", accessToken: "tok", publicToken: "pub", accountId: "acc_1" };
const PAYMENT = "pay_AbC123dEf456";
const args = { creds: keys, paymentId: PAYMENT, amountPaise: 24_550, receipt: "rf-txn1", notes: { transactionId: "txn1" } };

type Row = { id: string; amount: number; status: string; receipt?: string };

/** A fake Razorpay: `rows` are the payment's refunds, `post` answers the refund call. */
function fakeRazorpay(rows: Row[], post: (body: { amount: number; receipt: string }) => Response | Promise<Response>) {
  const posts: { body: { amount: number; receipt: string }; auth: string }[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (init?.method === "GET" && url.pathname === `/v1/payments/${PAYMENT}/refunds`) {
      return Response.json({ entity: "collection", count: rows.length, items: rows });
    }
    if (init?.method === "POST" && url.pathname === `/v1/payments/${PAYMENT}/refund`) {
      const body = JSON.parse(String(init.body)) as { amount: number; receipt: string };
      posts.push({ body, auth: (init.headers as Record<string, string>).Authorization ?? "" });
      return post(body);
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return posts;
}

const error400 = (description: string) => Response.json({ error: { code: "BAD_REQUEST_ERROR", description } }, { status: 400 });

async function reasonOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RazorpayRefundError);
  return (err as RazorpayRefundError).reason;
}

describe("refundPaymentViaRazorpay", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refunds the amount with our receipt, as the vendor", async () => {
    const posts = fakeRazorpay([], () => Response.json({ id: "rfnd_1", amount: 24_550, status: "pending" }));
    await expect(refundPaymentViaRazorpay(args)).resolves.toEqual({ refundId: "rfnd_1", alreadyRefunded: false });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ amount: 24_550, receipt: "rf-txn1", notes: { transactionId: "txn1" } });
    expect(posts[0]?.auth).toMatch(/^Basic /);
  });

  it("uses the OAuth token for a connected store", async () => {
    const posts = fakeRazorpay([], () => Response.json({ id: "rfnd_1", amount: 24_550, status: "processed" }));
    await refundPaymentViaRazorpay({ ...args, creds: oauth });
    expect(posts[0]?.auth).toBe("Bearer tok");
  });

  it("never refunds twice: an existing refund is returned with no second call", async () => {
    const posts = fakeRazorpay([{ id: "rfnd_0", amount: 24_550, status: "processed" }], () => new Response("{}", { status: 500 }));
    await expect(refundPaymentViaRazorpay(args)).resolves.toEqual({ refundId: "rfnd_0", alreadyRefunded: true });
    expect(posts).toHaveLength(0);
  });

  it("a phone that loses the race gets the winner's refund from the duplicate error", async () => {
    const rows: Row[] = [];
    const posts = fakeRazorpay(rows, () => {
      rows.push({ id: "rfnd_winner", amount: 24_550, status: "pending", receipt: "rf-txn1" });
      return error400("Duplicate receipt found for this refund request.");
    });
    await expect(refundPaymentViaRazorpay(args)).resolves.toEqual({ refundId: "rfnd_winner", alreadyRefunded: true });
    expect(posts).toHaveLength(1);
  });

  it("a timeout or 5xx that did reach Razorpay is found on the re-read", async () => {
    const rows: Row[] = [];
    fakeRazorpay(rows, () => {
      rows.push({ id: "rfnd_late", amount: 24_550, status: "pending" });
      return new Response("{}", { status: 502 });
    });
    await expect(refundPaymentViaRazorpay(args)).resolves.toEqual({ refundId: "rfnd_late", alreadyRefunded: true });
  });

  it("a 5xx that didn't is unavailable", async () => {
    fakeRazorpay([], () => new Response("{}", { status: 503 }));
    expect(await reasonOf(refundPaymentViaRazorpay(args))).toBe("unavailable");
  });

  it("reports a low balance so the seller knows what to do", async () => {
    fakeRazorpay([], () => error400("Your account does not have enough balance to carry out the refund operation."));
    expect(await reasonOf(refundPaymentViaRazorpay(args))).toBe("insufficient_balance");
  });

  it("anything else Razorpay refuses is refused", async () => {
    fakeRazorpay([], () => error400("The refund amount provided is greater than amount captured."));
    expect(await reasonOf(refundPaymentViaRazorpay(args))).toBe("refused");
    fakeRazorpay([], () => new Response("{}", { status: 401 }));
    expect(await reasonOf(refundPaymentViaRazorpay(args))).toBe("refused");
  });

  it("a refund Razorpay answers as failed didn't happen", async () => {
    fakeRazorpay([], () => Response.json({ id: "rfnd_1", amount: 24_550, status: "failed" }));
    expect(await reasonOf(refundPaymentViaRazorpay(args))).toBe("refused");
  });

  it("a failed refund doesn't count, and its receipt isn't reused", async () => {
    const posts = fakeRazorpay([{ id: "rfnd_f", amount: 24_550, status: "failed", receipt: "rf-txn1" }], () =>
      Response.json({ id: "rfnd_2", amount: 24_550, status: "pending" }),
    );
    await expect(refundPaymentViaRazorpay(args)).resolves.toEqual({ refundId: "rfnd_2", alreadyRefunded: false });
    expect(posts[0]?.body.receipt).toBe("rf-txn1-1");
  });

  it("only the remainder goes after a partial refund on the dashboard", async () => {
    const posts = fakeRazorpay([{ id: "rfnd_p", amount: 10_000, status: "processed" }], () =>
      Response.json({ id: "rfnd_3", amount: 14_550, status: "pending" }),
    );
    await refundPaymentViaRazorpay(args);
    expect(posts[0]?.body.amount).toBe(14_550);
  });

  it("refuses a malformed payment id without calling Razorpay", async () => {
    const posts = fakeRazorpay([], () => new Response("{}"));
    expect(await reasonOf(refundPaymentViaRazorpay({ ...args, paymentId: "../orders" }))).toBe("refused");
    expect(posts).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
