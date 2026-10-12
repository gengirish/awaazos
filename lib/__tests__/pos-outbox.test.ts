import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkoutSale,
  classifyStatus,
  pendingTodayPaise,
  removeSale,
  saleRejectedMessage,
  saleUnsavedMessage,
  syncOrder,
  syncOutbox,
  type OutboxSale,
} from "@/lib/pos-outbox";

// In-memory idb-keyval. `idb.broken` makes every call reject the way a broken
// IndexedDB backing store does in Chromium.
const idb = vi.hoisted(() => ({ data: new Map<string, unknown>(), broken: false }));
vi.mock("idb-keyval", () => {
  const guard = () => {
    if (idb.broken) throw new DOMException("Internal error.", "UnknownError");
  };
  return {
    createStore: () => ({}),
    get: async (k: string) => (guard(), idb.data.get(k)),
    set: async (k: string, v: unknown) => (guard(), void idb.data.set(k, v)),
    del: async (k: string) => (guard(), void idb.data.delete(k)),
    entries: async () => (guard(), [...idb.data.entries()]),
  };
});

function sale(over: Partial<OutboxSale>): OutboxSale {
  return {
    clientRef: "3b241101-e2bb-4255-8caf-4136c566a962",
    vendorId: "v1",
    clientCreatedAt: "2026-10-07T06:00:00.000Z",
    localNo: 1,
    body: {
      items: [{ name: "Chai", priceInPaise: 1500, qty: 2 }],
      subtotalPaise: 3000,
      taxPaise: 0,
      totalPaise: 3000,
      paymentMethod: "CASH",
      upiRef: null,
    },
    status: "pending",
    ...over,
  };
}

describe("classifyStatus", () => {
  it.each([
    [200, "ok"],
    [201, "ok"],
    [401, "auth"],
    // The account on this device can't reach the entry's vendor: keep it.
    [404, "auth"],
    [408, "retry"],
    [409, "retry"], // same Idempotency-Key still in flight
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [400, "rejected"],
    [402, "rejected"],
    [403, "rejected"],
    [422, "rejected"],
  ] as const)("%i → %s", (status, kind) => {
    expect(classifyStatus(status)).toBe(kind);
  });
});

describe("pendingTodayPaise", () => {
  const now = new Date("2026-10-07T12:00:00.000Z"); // 17:30 IST

  it("sums pending sales from today's IST day only", () => {
    const sales = [
      sale({ localNo: 1, clientCreatedAt: "2026-10-07T06:00:00.000Z" }),
      // 00:10 IST on 7 Oct counts as today…
      sale({ localNo: 2, clientCreatedAt: "2026-10-06T18:40:00.000Z" }),
      // …23:50 IST on 6 Oct does not.
      sale({ localNo: 3, clientCreatedAt: "2026-10-06T18:20:00.000Z" }),
    ];
    expect(pendingTodayPaise(sales, now)).toBe(6000);
  });

  it("ignores failed sales", () => {
    expect(pendingTodayPaise([sale({ status: "failed", failCode: "client_time_too_old" })], now)).toBe(0);
  });
});

describe("syncOrder", () => {
  it("sends pending sales oldest first and skips failed ones", () => {
    const a = sale({ localNo: 1, clientRef: "a", clientCreatedAt: "2026-10-07T06:00:00.000Z" });
    const b = sale({ localNo: 2, clientRef: "b", clientCreatedAt: "2026-10-07T05:00:00.000Z" });
    const c = sale({ localNo: 3, clientRef: "c", status: "failed" });
    expect(syncOrder([a, b, c]).map((s) => s.clientRef)).toEqual(["b", "a"]);
  });

  it("breaks ties on the local number", () => {
    const t = "2026-10-07T06:00:00.000Z";
    const x = sale({ localNo: 5, clientRef: "x", clientCreatedAt: t });
    const y = sale({ localNo: 4, clientRef: "y", clientCreatedAt: t });
    expect(syncOrder([x, y]).map((s) => s.clientRef)).toEqual(["y", "x"]);
  });
});

describe("saleRejectedMessage", () => {
  it("maps the codes a vendor can act on", () => {
    expect(saleRejectedMessage("monthly_txn_cap_reached", 402)).toBe("Monthly bill limit reached for your plan");
    expect(saleRejectedMessage("billing_locked", 402)).toMatch(/free trial has ended/);
    expect(saleRejectedMessage("total_mismatch", 400)).toMatch(/didn't add up/);
    expect(saleRejectedMessage("subtotal_mismatch", 400)).toMatch(/didn't add up/);
    expect(saleRejectedMessage("No vendor membership.", 403)).toMatch(/can't record sales for this store/);
  });

  it("never passes a server string through", () => {
    for (const raw of ["Invalid input", "Invalid JSON body.", "Internal error.", "400", "toString"]) {
      expect(saleRejectedMessage(raw, 400)).toBe("Could not record payment");
    }
  });
});

describe("checkoutSale", () => {
  const VENDOR = "v1";
  const BODY = sale({}).body;
  const BILL = { billNumber: "AWZ-20261007-0001", totalPaise: 3000, paymentMethod: "CASH" };
  const fetchMock = vi.fn();

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  /** clientRef of the nth POST, read from the request body. */
  const postedRef = (n: number) =>
    (JSON.parse((fetchMock.mock.calls[n]![1] as RequestInit).body as string) as { clientRef: string }).clientRef;
  const storedSales = () => [...idb.data.keys()].filter((k) => k.startsWith("sale:"));

  beforeEach(() => {
    idb.data.clear();
    idb.broken = false;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout, clearTimeout, dispatchEvent: () => true });
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(async () => {
    // Let the fire-and-forget drain after a synced sale settle.
    await syncOutbox(VENDOR);
    vi.unstubAllGlobals();
  });

  it("storage works: saves, posts, then clears the entry", async () => {
    fetchMock.mockResolvedValue(json(201, { transaction: BILL }));
    await expect(checkoutSale(VENDOR, BODY)).resolves.toEqual({ kind: "synced", bill: BILL });
    expect(storedSales()).toEqual([]);
  });

  it("storage works, network down: queued on the device", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(checkoutSale(VENDOR, BODY)).resolves.toEqual({ kind: "queued", localNo: 1, needsSignIn: false });
    expect(storedSales()).toHaveLength(1);
  });

  it("storage fails, post ok: a normal synced sale", async () => {
    idb.broken = true;
    fetchMock.mockResolvedValue(json(201, { transaction: BILL }));
    await expect(checkoutSale(VENDOR, BODY)).resolves.toEqual({ kind: "synced", bill: BILL });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/transactions?vendor=v1");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(postedRef(0));
    expect(JSON.parse(init.body as string)).toMatchObject({ vendorId: VENDOR, deferred: false, totalPaise: 3000 });
  });

  it("storage fails, post rejected: the server's code and status, nothing queued", async () => {
    idb.broken = true;
    fetchMock.mockResolvedValue(json(402, { error: "monthly_txn_cap_reached", code: "monthly_txn_cap_reached" }));
    await expect(checkoutSale(VENDOR, BODY)).resolves.toEqual({
      kind: "rejected",
      code: "monthly_txn_cap_reached",
      status: 402,
    });
  });

  it.each([
    ["network down", () => fetchMock.mockRejectedValue(new TypeError("Failed to fetch")), "network"],
    ["5xx", () => fetchMock.mockResolvedValue(json(503, { error: "Internal server error" })), "network"],
    ["signed out", () => fetchMock.mockResolvedValue(json(401, { error: "Unauthorized" })), "auth"],
  ] as const)("storage fails, %s: unsaved, never queued", async (_name, arrange, reason) => {
    idb.broken = true;
    arrange();
    const result = await checkoutSale(VENDOR, BODY);
    expect(result).toEqual({ kind: "unsaved", clientRef: postedRef(0), reason });
  });

  it("storage fails and the browser is offline: unsaved without a request", async () => {
    idb.broken = true;
    vi.stubGlobal("navigator", { onLine: false });
    const result = await checkoutSale(VENDOR, BODY);
    expect(result).toMatchObject({ kind: "unsaved", reason: "network" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a retry of an unsaved sale replays the same clientRef", async () => {
    idb.broken = true;
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = await checkoutSale(VENDOR, BODY);
    if (first.kind !== "unsaved") throw new Error(`expected unsaved, got ${first.kind}`);

    // The first post had landed: the server answers the replay with that bill.
    fetchMock.mockResolvedValueOnce(json(200, { transaction: BILL }));
    await expect(checkoutSale(VENDOR, BODY, { clientRef: first.clientRef })).resolves.toEqual({
      kind: "synced",
      bill: BILL,
    });
    expect(postedRef(1)).toBe(postedRef(0));
    expect(postedRef(1)).toBe(first.clientRef);
  });

  it("without a clientRef each checkout gets a fresh one", async () => {
    idb.broken = true;
    fetchMock.mockImplementation(async () => json(201, { transaction: BILL }));
    await checkoutSale(VENDOR, BODY);
    await checkoutSale(VENDOR, BODY);
    expect(postedRef(1)).not.toBe(postedRef(0));
  });

  it("saved and posted, but the entry can't be deleted: still a synced sale", async () => {
    fetchMock.mockImplementation(async () => {
      idb.broken = true;
      return json(201, { transaction: BILL });
    });
    await expect(checkoutSale(VENDOR, BODY)).resolves.toEqual({ kind: "synced", bill: BILL });
  });

  it("removeSale and syncOutbox never reject on broken storage", async () => {
    idb.broken = true;
    await expect(removeSale(VENDOR, "any")).resolves.toBeUndefined();
    await expect(syncOutbox(VENDOR)).resolves.toEqual({ synced: 0, remaining: 0, needsSignIn: false });
  });

  it("unsaved messages are plain", () => {
    expect(saleUnsavedMessage("network")).toBe("Couldn't save this sale. Check your connection and try again.");
    expect(saleUnsavedMessage("auth")).toBe("Couldn't save this sale. Sign in again, then try again.");
  });
});
