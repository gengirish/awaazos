/**
 * POST /api/ai/parse-menu and POST /api/menu/bulk — handler tests with auth,
 * Prisma, rate limits, idempotency, usage guard and the Anthropic clients
 * mocked. No DB, no network. (The bulk route's real DB behaviour is covered by
 * menu-bulk.db.test.ts.)
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: true as boolean,
  apiKey: "test-key" as string | null,
  usage: { ok: true } as { ok: true } | { ok: false; code: string; message: string },
  aiLimited: false,
  writeLimited: false,
  idem: { kind: "disabled" } as { kind: string; record?: { status: number; body: unknown } },
  commit: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  haikuCreate: vi.fn(),
  sonnetCreate: vi.fn(),
  requireVendorRole: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {},
  requireEnv: (key: string) => {
    if (key === "ANTHROPIC_API_KEY" && h.apiKey) return h.apiKey;
    throw new Error(`Required environment variable ${key} is not configured`);
  },
}));

vi.mock("@/lib/rbac", () => {
  class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  h.requireVendorRole.mockImplementation(async () => {
    if (!h.auth) throw new AuthError(401, "Unauthorized");
    return { vendor: { id: "v_1", plan: "STARTER" }, setVendorCookie: "v_1" };
  });
  return { AuthError, requireActiveBilling: () => {}, requireVendorRole: h.requireVendorRole };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { menuItem: { findMany: h.findMany }, $transaction: h.transaction },
}));

vi.mock("@/lib/ratelimit", () => {
  const ai = { check: async () => (h.aiLimited ? { ok: false } : { ok: true }) };
  return {
    getAiLimiterForPlan: () => ({ minute: ai, burst: ai }),
    writeRateLimit: { check: async () => (h.writeLimited ? { ok: false } : { ok: true }) },
    tooManyRequests: (_r: unknown, scope: string) =>
      new Response(JSON.stringify({ error: "rate_limited", scope }), { status: 429 }),
  };
});

vi.mock("@/lib/idempotency", () => ({
  getIdempotencyKey: (req: Request) => req.headers.get("idempotency-key"),
  beginIdempotency: async () => (h.idem.kind === "fresh" ? { kind: "fresh", commit: h.commit } : h.idem),
}));

vi.mock("@/lib/ai-usage-guard", () => ({ reserveAnthropicTokens: h.reserve }));

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...real,
    anthropicHaiku: { messages: { create: h.haikuCreate } },
    anthropicSonnet: { messages: { create: h.sonnetCreate } },
  };
});

import { POST as parseMenuPOST } from "@/app/api/ai/parse-menu/route";
import { POST as bulkPOST } from "@/app/api/menu/bulk/route";
import type { MenuDraft } from "@/lib/parse-menu-types";

const MENU_ROWS = [
  { id: "mi_samosa", slug: "samosa", name: "Samosa", aliases: ["samosa"], tags: [], priceInPaise: 2_000, category: "Snacks", emoji: "🥟" },
  { id: "mi_hidden", slug: "kachori", name: "Kachori", aliases: ["kachori"], tags: [], priceInPaise: 2_000, category: "Snacks", emoji: "🥟" },
];

/** Fixed idempotency header for the replay tests (not a secret). */
const REPLAY_ID = "replay-test-1";

function toolMessage(input: unknown) {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "m",
    content: [{ type: "tool_use", id: "t", name: "add_menu_items", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function req(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const menuReq = (body: unknown) => req("http://localhost/api/ai/parse-menu", body);
const bulkReq = (body: unknown, headers?: Record<string, string>) => req("http://localhost/api/menu/bulk", body, headers);

beforeEach(() => {
  h.auth = true;
  h.apiKey = "test-key";
  h.aiLimited = false;
  h.writeLimited = false;
  h.idem = { kind: "disabled" };
  h.commit.mockReset();
  h.usage = { ok: true };
  h.findMany.mockReset().mockResolvedValue(MENU_ROWS);
  h.reserve.mockReset().mockImplementation(async () => h.usage);
  h.transaction.mockReset();
  h.haikuCreate.mockReset().mockResolvedValue(
    toolMessage({
      items: [
        { name: "Samosa", priceRupees: 25, category: "snacks", existingMenuItemId: "mi_samosa" },
        { name: "Kachori", priceRupees: 20, category: "Snacks", existingMenuItemId: "mi_from_another_vendor" },
        { name: "Mango Lassi", priceRupees: 60, category: "drinks" },
      ],
      unparsed: [],
    }),
  );
  h.sonnetCreate.mockReset();
});

describe("POST /api/ai/parse-menu", () => {
  it("returns a MenuDraft under data, matched against the vendor's whole menu", async () => {
    const res = await parseMenuPOST(menuReq({ transcript: "samosa 25, kachori 20, snacks mein. mango lassi 60 drinks", lang: "hi-IN" }));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: MenuDraft };
    expect(data.model).toBe("haiku");
    expect(data.items.map((i) => [i.name, i.action, i.existingMenuItemId, i.priceInPaise, i.category])).toEqual([
      ["Samosa", "update_price", "mi_samosa", 2_500, "Snacks"],
      ["Kachori", "unchanged", "mi_hidden", 2_000, "Snacks"],
      ["Mango Lassi", "create", null, 6_000, "Drinks"],
    ]);

    expect(h.requireVendorRole).toHaveBeenCalledWith("CASHIER", undefined, expect.anything());
    // All items, unavailable ones included.
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "v_1" } }));
    expect(h.reserve).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "v_1", plan: "STARTER" }));
    expect(h.sonnetCreate).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain("awz_vendor=v_1");
  });

  it("401 when signed out", async () => {
    h.auth = false;
    expect((await parseMenuPOST(menuReq({ transcript: "x" }))).status).toBe(401);
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("400 on empty / oversize transcript and malformed JSON", async () => {
    expect((await parseMenuPOST(menuReq({ transcript: "" }))).status).toBe(400);
    expect((await parseMenuPOST(menuReq({ transcript: "a".repeat(2001) }))).status).toBe(400);
    expect((await parseMenuPOST(menuReq("{not json"))).status).toBe(400);
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("accepts a 2000-char transcript", async () => {
    expect((await parseMenuPOST(menuReq({ transcript: "a".repeat(2000) }))).status).toBe(200);
  });

  it("429 when the AI rate limit trips", async () => {
    h.aiLimited = true;
    expect((await parseMenuPOST(menuReq({ transcript: "samosa 20" }))).status).toBe(429);
  });

  it("503 voice_unavailable when ANTHROPIC_API_KEY is missing", async () => {
    h.apiKey = null;
    const res = await parseMenuPOST(menuReq({ transcript: "samosa 20" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "voice_unavailable", fallback: "form" });
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("402 when the Anthropic cap is reached", async () => {
    h.usage = { ok: false, code: "vendor_anthropic_cap_reached", message: "Monthly Anthropic cap reached for this plan." };
    const res = await parseMenuPOST(menuReq({ transcript: "samosa 20" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Monthly Anthropic cap reached for this plan.", code: "vendor_anthropic_cap_reached" });
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("escalates to Sonnet when Haiku fails, 500 with form fallback when both fail", async () => {
    h.haikuCreate.mockRejectedValue(new Error("overloaded"));
    h.sonnetCreate.mockResolvedValue(toolMessage({ items: [{ name: "Poha", priceRupees: 30, category: null }] }));
    const ok = await parseMenuPOST(menuReq({ transcript: "poha 30" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: MenuDraft }).data.model).toBe("sonnet");

    h.sonnetCreate.mockRejectedValue(new Error("down"));
    const bad = await parseMenuPOST(menuReq({ transcript: "poha 30" }));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "Internal server error", fallback: "form" });
  });
});

describe("POST /api/menu/bulk (validation and guards)", () => {
  const row = { name: "Poha", priceInPaise: 3_000, category: "Breakfast", emoji: "🍛", aliases: ["poha"] };

  it("400 on empty, oversize, zero/fractional/absurd price, malformed JSON — before touching the DB", async () => {
    for (const body of [
      { items: [] },
      { items: Array.from({ length: 51 }, (_, i) => ({ ...row, name: `Dish ${i}` })) },
      { items: [{ ...row, priceInPaise: 0 }] },
      { items: [{ ...row, priceInPaise: 12.5 }] },
      { items: [{ ...row, priceInPaise: 10_000_001 }] },
      { items: [{ ...row, name: " " }] },
    ]) {
      expect((await bulkPOST(bulkReq(body))).status).toBe(400);
    }
    expect((await bulkPOST(bulkReq("{nope"))).status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("401 signed out, 429 when the write limiter trips", async () => {
    h.auth = false;
    expect((await bulkPOST(bulkReq({ items: [row] }))).status).toBe(401);
    h.auth = true;
    h.writeLimited = true;
    expect((await bulkPOST(bulkReq({ items: [row] }))).status).toBe(429);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("replays a completed Idempotency-Key and 409s one in flight", async () => {
    h.idem = { kind: "replay", record: { status: 201, body: { data: { created: [], updated: [], skipped: [] } } } };
    const replay = await bulkPOST(bulkReq({ items: [row] }, { "idempotency-key": REPLAY_ID }));
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ data: { created: [], updated: [], skipped: [] } });

    h.idem = { kind: "in_flight" };
    expect((await bulkPOST(bulkReq({ items: [row] }, { "idempotency-key": REPLAY_ID }))).status).toBe(409);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("commits the response for a fresh Idempotency-Key", async () => {
    h.idem = { kind: "fresh" };
    h.transaction.mockResolvedValue({ created: [{ id: "new" }], updated: [] });
    const res = await bulkPOST(bulkReq({ items: [row] }, { "idempotency-key": REPLAY_ID }));
    expect(res.status).toBe(201);
    expect(h.commit).toHaveBeenCalledWith({ status: 201, body: { data: { created: [{ id: "new" }], updated: [], skipped: [] } } });
  });

  it("409 on a slug race (P2002), nothing saved", async () => {
    const { Prisma } = await import("@prisma/client");
    h.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const res = await bulkPOST(bulkReq({ items: [row] }));
    expect(res.status).toBe(409);
  });
});
