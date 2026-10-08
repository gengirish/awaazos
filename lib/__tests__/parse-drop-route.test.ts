/**
 * POST /api/ai/parse-drop — handler test with auth, Prisma, rate limit, usage
 * guard and the Anthropic clients mocked. No DB, no network.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: true as boolean,
  role: "MANAGER" as string,
  apiKey: "test-key" as string | null,
  usage: { ok: true } as { ok: true } | { ok: false; code: string; message: string },
  limited: false,
  findMany: vi.fn(),
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
  h.requireVendorRole.mockImplementation(async (minRole: string) => {
    if (!h.auth) throw new AuthError(401, "Unauthorized");
    if (minRole === "MANAGER" && h.role === "CASHIER") throw new AuthError(403, "Forbidden");
    return { vendor: { id: "v_1", plan: "STARTER" }, setVendorCookie: "v_1" };
  });
  return { AuthError, requireVendorRole: h.requireVendorRole };
});

vi.mock("@/lib/prisma", () => ({ prisma: { menuItem: { findMany: h.findMany } } }));

vi.mock("@/lib/ratelimit", () => {
  const limiter = {
    check: async () => (h.limited ? { ok: false, limit: 1, remaining: 0, resetMs: 1000 } : { ok: true }),
  };
  return {
    getAiLimiterForPlan: () => ({ minute: limiter, burst: limiter }),
    tooManyRequests: (_r: unknown, scope: string) =>
      new Response(JSON.stringify({ error: "Too many requests", scope }), { status: 429 }),
  };
});

vi.mock("@/lib/ai-usage-guard", () => ({ reserveAnthropicTokens: h.reserve }));

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...real,
    anthropicHaiku: { messages: { create: h.haikuCreate } },
    anthropicSonnet: { messages: { create: h.sonnetCreate } },
  };
});

import { POST } from "@/app/api/ai/parse-drop/route";

const MENU_ROWS = [
  { id: "mi_laddu", slug: null, name: "Ragi Laddu", aliases: ["laddu"], tags: [], priceInPaise: 12_000 },
  { id: "mi_thepla", slug: null, name: "Methi Thepla", aliases: ["thepla"], tags: [], priceInPaise: 8_000 },
];

function toolMessage(input: unknown) {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "m",
    content: [{ type: "tool_use", id: "t", name: "build_drop", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/parse-drop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.auth = true;
  h.role = "MANAGER";
  h.apiKey = "test-key";
  h.limited = false;
  h.findMany.mockReset().mockResolvedValue(MENU_ROWS);
  h.reserve.mockReset().mockImplementation(async () => h.usage);
  h.usage = { ok: true };
  h.haikuCreate.mockReset().mockResolvedValue(
    toolMessage({
      day: { kind: "tomorrow" },
      fulfilmentMode: "PICKUP",
      windowStart: "18:00",
      windowEnd: "20:00",
      items: [
        { menuItemId: "mi_laddu", spokenName: "ragi laddu", quantity: 20, priceRupees: 150 },
        { menuItemId: "mi_from_another_vendor", spokenName: "gulab jamun", quantity: 5 },
        { menuItemId: "mi_thepla", spokenName: "thepla", quantity: 15 },
      ],
    }),
  );
  h.sonnetCreate.mockReset();
});

describe("POST /api/ai/parse-drop", () => {
  it("returns a DropDraft under data, scoped to the vendor's available menu", async () => {
    const res = await POST(req({ transcript: "kal 20 ragi laddu 150 rupaye, 15 thepla, pickup shaam 6 se 8", lang: "hi-IN" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: import("@/lib/parse-drop-types").DropDraft };
    expect(json.data.model).toBe("haiku");
    expect(json.data.fulfilmentMode).toBe("PICKUP");
    expect(json.data.items.map((i) => [i.menuItemId, i.priceInPaise, i.maxQty])).toEqual([
      ["mi_laddu", 15_000, 20],
      ["mi_thepla", 8_000, 15],
    ]);
    expect(json.data.unmatched).toEqual([{ spokenName: "gulab jamun", quantity: 5 }]);

    expect(h.requireVendorRole).toHaveBeenCalledWith("MANAGER", undefined, expect.anything());
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vendorId: "v_1", isAvailable: true } }),
    );
    expect(h.reserve).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "v_1", plan: "STARTER" }));
    expect(h.sonnetCreate).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain("awz_vendor=v_1");
  });

  it("401 when signed out, 403 for a cashier", async () => {
    h.auth = false;
    expect((await POST(req({ transcript: "x" }))).status).toBe(401);
    h.auth = true;
    h.role = "CASHIER";
    expect((await POST(req({ transcript: "x" }))).status).toBe(403);
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("400 on empty / oversize transcript and malformed JSON", async () => {
    expect((await POST(req({ transcript: "" }))).status).toBe(400);
    expect((await POST(req({ transcript: "a".repeat(1001) }))).status).toBe(400);
    expect((await POST(req("{not json"))).status).toBe(400);
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("429 when the AI rate limit trips", async () => {
    h.limited = true;
    expect((await POST(req({ transcript: "20 laddu" }))).status).toBe(429);
  });

  it("503 voice_unavailable when ANTHROPIC_API_KEY is missing", async () => {
    h.apiKey = null;
    const res = await POST(req({ transcript: "20 laddu" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "voice_unavailable", fallback: "form" });
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("402 with the parse-order code when the Anthropic cap is reached", async () => {
    h.usage = { ok: false, code: "vendor_anthropic_cap_reached", message: "Monthly Anthropic cap reached for this plan." };
    const res = await POST(req({ transcript: "20 laddu" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Monthly Anthropic cap reached for this plan.",
      code: "vendor_anthropic_cap_reached",
    });
    expect(h.haikuCreate).not.toHaveBeenCalled();
  });

  it("escalates to Sonnet when Haiku fails, 500 with form fallback when both fail", async () => {
    h.haikuCreate.mockRejectedValue(new Error("overloaded"));
    h.sonnetCreate.mockResolvedValue(
      toolMessage({ items: [{ menuItemId: "mi_thepla", spokenName: "thepla", quantity: 3 }] }),
    );
    const ok = await POST(req({ transcript: "3 thepla" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: { model: string } }).data.model).toBe("sonnet");

    h.sonnetCreate.mockRejectedValue(new Error("down"));
    const bad = await POST(req({ transcript: "3 thepla" }));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "Internal server error", fallback: "form" });
  });
});
