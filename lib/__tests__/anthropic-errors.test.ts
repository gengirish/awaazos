/**
 * Error handling against the real SDK error classes.
 *
 * The Haiku/Sonnet singletons are swapped for real `Anthropic` clients whose
 * `fetch` returns canned HTTP errors (or hangs / rejects), so the SDK itself
 * raises RateLimitError, InternalServerError, APIConnectionTimeoutError, etc.
 * Asserts that a Haiku failure still escalates to Sonnet and that both-failed
 * still maps to the same HTTP responses in /api/ai/parse-order,
 * /api/ai/parse-drop and /api/ai/parse-menu. No network, no API key.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

type Reply = (init: { signal?: AbortSignal | null }) => Promise<Response>;

const h = vi.hoisted(() => ({
  haiku: null as unknown as (init: { signal?: AbortSignal | null }) => Promise<Response>,
  sonnet: null as unknown as (init: { signal?: AbortSignal | null }) => Promise<Response>,
  haikuCalls: 0,
  sonnetCalls: 0,
}));

vi.mock("@/lib/env", () => ({
  env: {},
  requireEnv: () => "test-anthropic-key",
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
  return {
    AuthError,
    requireActiveBilling: () => {},
    requireVendorRole: async () => ({ vendor: { id: "v_1", plan: "STARTER" }, setVendorCookie: null }),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    menuItem: {
      findMany: async () => [
        { id: "mi_chai", slug: null, name: "Chai", aliases: ["cha"], tags: [], priceInPaise: 1_000 },
        { id: "mi_samosa", slug: null, name: "Samosa", aliases: [], tags: [], priceInPaise: 1_500 },
      ],
    },
  },
}));

vi.mock("@/lib/ratelimit", () => {
  const limiter = { check: async () => ({ ok: true }) };
  return {
    getAiLimiterForPlan: () => ({ minute: limiter, burst: limiter }),
    tooManyRequests: () => new Response(null, { status: 429 }),
  };
});

vi.mock("@/lib/ai-usage-guard", () => ({ reserveAnthropicTokens: async () => ({ ok: true }) }));

vi.mock("@/lib/queues", () => ({
  getVoiceLogQueue: () => ({ add: async () => undefined }),
}));

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/anthropic")>();
  const { default: Sdk } = await import("@anthropic-ai/sdk");
  const make = (tier: "haiku" | "sonnet") =>
    new Sdk({
      apiKey: "test-anthropic-key",
      maxRetries: 0,
      // Short so the hang case trips APIConnectionTimeoutError quickly.
      timeout: 200,
      fetch: (async (_url: unknown, init: { signal?: AbortSignal | null }) => {
        if (tier === "haiku") h.haikuCalls++;
        else h.sonnetCalls++;
        return (tier === "haiku" ? h.haiku : h.sonnet)(init);
      }) as never,
    });
  return { ...real, anthropicHaiku: make("haiku"), anthropicSonnet: make("sonnet") };
});

import { POST as parseOrderPOST } from "@/app/api/ai/parse-order/route";
import { POST as parseDropPOST } from "@/app/api/ai/parse-drop/route";
import { POST as parseMenuPOST } from "@/app/api/ai/parse-menu/route";
import { anthropicHaiku } from "@/lib/anthropic";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_test", ...headers },
  });

const apiError = (status: number, type: string): Reply => async () =>
  json(status, { type: "error", error: { type, message: `${type} from test` } }, status === 429 ? { "retry-after": "1" } : {});

const hang: Reply = (init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

const networkDown: Reply = async () => {
  throw new TypeError("fetch failed");
};

function toolReply(name: string, input: unknown): Reply {
  return async () =>
    json(200, {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [{ type: "tool_use", id: "toolu_test", name, input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
}

const ORDER_OK = toolReply("add_items", {
  items: [{ menuItemId: "mi_chai", name: "Chai", priceInPaise: 1_000, qty: 2 }],
  unmatched: [],
  confidence: "high",
});
const DROP_OK = toolReply("build_drop", {
  day: { kind: "tomorrow" },
  items: [{ menuItemId: "mi_samosa", spokenName: "samosa", quantity: 30 }],
});

const MENU_OK = toolReply("add_menu_items", {
  items: [
    { name: "Samosa", priceRupees: 20, category: "Snacks", existingMenuItemId: "mi_samosa" },
    { name: "Cutting Chai", priceRupees: 10, category: "Chai" },
  ],
  unparsed: [],
});

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const orderReq = () =>
  post("http://localhost/api/ai/parse-order", { transcript: "do chai", lang: "hi-IN", sttSource: "webspeech" });
const menuReq = () =>
  post("http://localhost/api/ai/parse-menu", { transcript: "samosa 20, cutting chai 10", lang: "hi-IN" });
const dropReq = () => post("http://localhost/api/ai/parse-drop", { transcript: "kal 30 samosa", lang: "hi-IN" });

beforeEach(() => {
  h.haikuCalls = 0;
  h.sonnetCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("SDK raises its typed errors through our clients", () => {
  it.each([
    [400, "invalid_request_error", Anthropic.BadRequestError],
    [401, "authentication_error", Anthropic.AuthenticationError],
    [429, "rate_limit_error", Anthropic.RateLimitError],
    [500, "api_error", Anthropic.InternalServerError],
    [529, "overloaded_error", Anthropic.InternalServerError],
  ] as const)("HTTP %i → %s", async (status, type, Cls) => {
    h.haiku = apiError(status, type);
    const err = await anthropicHaiku.messages
      .create({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect((err as InstanceType<typeof Anthropic.APIError>).status).toBe(status);
  });

  it("request exceeding the client timeout → APIConnectionTimeoutError", async () => {
    h.haiku = hang;
    const err = await anthropicHaiku.messages
      .create({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
  });

  it("network failure → APIConnectionError", async () => {
    h.haiku = networkDown;
    const err = await anthropicHaiku.messages
      .create({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Anthropic.APIConnectionError);
  });
});

describe("POST /api/ai/parse-order with SDK errors", () => {
  it.each([
    ["429 rate limit", apiError(429, "rate_limit_error")],
    ["529 overloaded", apiError(529, "overloaded_error")],
    ["500 api error", apiError(500, "api_error")],
    ["network down", networkDown],
  ])("Haiku %s → escalates to Sonnet, 200", async (_label, haikuReply) => {
    h.haiku = haikuReply;
    h.sonnet = ORDER_OK;
    const res = await parseOrderPOST(orderReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { menuItemId: string; qty: number }[]; modelUsed: string };
    expect(body.modelUsed).toBe("claude-sonnet-4-5");
    expect(body.items.map((i) => [i.menuItemId, i.qty])).toEqual([["mi_chai", 2]]);
    expect([h.haikuCalls, h.sonnetCalls]).toEqual([1, 1]);
  });

  it("Haiku timeout (APIConnectionTimeoutError) → escalates to Sonnet", async () => {
    h.haiku = hang;
    h.sonnet = ORDER_OK;
    const res = await parseOrderPOST(orderReq());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { modelUsed: string }).modelUsed).toBe("claude-sonnet-4-5");
  });

  it("both tiers fail → 500 Internal server error", async () => {
    h.haiku = apiError(529, "overloaded_error");
    h.sonnet = apiError(429, "rate_limit_error");
    const res = await parseOrderPOST(orderReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect([h.haikuCalls, h.sonnetCalls]).toEqual([1, 1]);
  });
});

describe("POST /api/ai/parse-drop with SDK errors", () => {
  it("Haiku 529 → escalates to Sonnet, 200", async () => {
    h.haiku = apiError(529, "overloaded_error");
    h.sonnet = DROP_OK;
    const res = await parseDropPOST(dropReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { model: string; items: { menuItemId: string }[] } };
    expect(body.data.model).toBe("sonnet");
    expect(body.data.items.map((i) => i.menuItemId)).toEqual(["mi_samosa"]);
  });

  it("both tiers fail → 500 with form fallback", async () => {
    h.haiku = apiError(500, "api_error");
    h.sonnet = networkDown;
    const res = await parseDropPOST(dropReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error", fallback: "form" });
  });
});

describe("POST /api/ai/parse-menu with SDK errors", () => {
  it.each([
    ["429 rate limit", apiError(429, "rate_limit_error")],
    ["529 overloaded", apiError(529, "overloaded_error")],
    ["network down", networkDown],
  ])("Haiku %s → escalates to Sonnet, 200", async (_label, haikuReply) => {
    h.haiku = haikuReply;
    h.sonnet = MENU_OK;
    const res = await parseMenuPOST(menuReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { model: string; items: { name: string; action: string; existingMenuItemId: string | null }[] };
    };
    expect(body.data.model).toBe("sonnet");
    expect(body.data.items.map((i) => [i.name, i.action, i.existingMenuItemId])).toEqual([
      ["Samosa", "update_price", "mi_samosa"],
      ["Cutting Chai", "create", null],
    ]);
    // Per-request maxRetries (Haiku 1, Sonnet 0) — a 429/529 Haiku is retried once.
    expect([h.haikuCalls, h.sonnetCalls]).toEqual([2, 1]);
  });

  it("both tiers fail → 500 with form fallback", async () => {
    h.haiku = apiError(500, "api_error");
    h.sonnet = apiError(529, "overloaded_error");
    const res = await parseMenuPOST(menuReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error", fallback: "form" });
    expect([h.haikuCalls, h.sonnetCalls]).toEqual([2, 1]);
  });
});
