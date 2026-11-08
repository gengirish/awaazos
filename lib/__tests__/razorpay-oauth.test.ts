import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    const v = process.env[key];
    if (v === undefined || v === "") throw new Error(`${key} not set`);
    return v;
  },
}));

import {
  authorizeUrl,
  createOauthState,
  exchangeCode,
  parseTokenResponse,
  publicTokenMode,
  razorpayOauthConfig,
  RazorpayOauthError,
  readOauthState,
} from "@/lib/razorpay-oauth";

const NOW = new Date("2026-10-30T06:00:00.000Z");

const TOKEN_JSON = {
  token_type: "Bearer",
  expires_in: 7862400,
  access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.access",
  refresh_token: "def50200refreshtokenvalue",
  public_token: "rzp_test_oauth_9xu1rkZqoXlClS",
  razorpay_account_id: "acc_Dhk2qDbmu6FwZH",
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-at-least-32-chars-long");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("state", () => {
  it("round-trips to the vendor id with the matching cookie nonce", () => {
    const { state, nonce } = createOauthState("vendor_abc123", NOW);
    expect(readOauthState(state, nonce, NOW)).toBe("vendor_abc123");
  });

  it("rejects a tampered payload, another browser's nonce, expiry and junk", () => {
    const { state, nonce } = createOauthState("vendor_abc123", NOW);
    const [body, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ v: "vendor_victim", n: nonce, e: NOW.getTime() + 60_000 })).toString(
      "base64url",
    );
    expect(readOauthState(`${forged}.${mac}`, nonce, NOW)).toBeNull();
    expect(readOauthState(`${body}.${mac}x`, nonce, NOW)).toBeNull();
    expect(readOauthState(state, createOauthState("vendor_abc123", NOW).nonce, NOW)).toBeNull();
    expect(readOauthState(state, null, NOW)).toBeNull();
    expect(readOauthState(state, nonce, new Date(NOW.getTime() + 11 * 60_000))).toBeNull();
    expect(readOauthState("nodot", nonce, NOW)).toBeNull();
    expect(readOauthState(null, nonce, NOW)).toBeNull();
  });

  it("depends on AUTH_SECRET", () => {
    const { state, nonce } = createOauthState("vendor_abc123", NOW);
    vi.stubEnv("AUTH_SECRET", "a-different-secret-also-32-chars-long");
    expect(readOauthState(state, nonce, NOW)).toBeNull();
  });
});

describe("config", () => {
  it("is null without client id + secret; anything but 'live' is test mode", () => {
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_ID", "");
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_SECRET", "s");
    expect(razorpayOauthConfig()).toBeNull();
    vi.stubEnv("RAZORPAY_OAUTH_CLIENT_ID", "Tu7LkS5XB21QzW");
    vi.stubEnv("RAZORPAY_OAUTH_MODE", "");
    expect(razorpayOauthConfig()?.mode).toBe("test");
    vi.stubEnv("RAZORPAY_OAUTH_MODE", "Live ");
    expect(razorpayOauthConfig()?.mode).toBe("live");
    vi.stubEnv("RAZORPAY_OAUTH_MODE", "production");
    expect(razorpayOauthConfig()?.mode).toBe("test");
  });

  it("authorize URL carries client id, redirect, read_write scope and state", () => {
    const url = new URL(
      authorizeUrl({ clientId: "cid", clientSecret: "x", mode: "test" }, "https://a.example/cb", "st.ate"),
    );
    expect(url.origin + url.pathname).toBe("https://auth.razorpay.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      response_type: "code",
      redirect_uri: "https://a.example/cb",
      scope: "read_write",
      state: "st.ate",
    });
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
});

describe("tokens", () => {
  it("parses Razorpay's token response", () => {
    const t = parseTokenResponse(TOKEN_JSON, NOW);
    expect(t.accountId).toBe("acc_Dhk2qDbmu6FwZH");
    expect(t.publicToken).toBe("rzp_test_oauth_9xu1rkZqoXlClS");
    expect(t.accessExpiresAt.getTime()).toBe(NOW.getTime() + 7862400 * 1000);
    expect(t.refreshExpiresAt.getTime() - NOW.getTime()).toBe(179 * 24 * 60 * 60 * 1000);
    expect(publicTokenMode(t.publicToken)).toBe("test");
    expect(publicTokenMode("rzp_live_oauth_abcdef123")).toBe("live");
  });

  it("rejects a response missing any field", () => {
    for (const key of Object.keys(TOKEN_JSON)) {
      if (key === "token_type") continue;
      const broken: Record<string, unknown> = { ...TOKEN_JSON };
      delete broken[key];
      expect(() => parseTokenResponse(broken, NOW)).toThrow(RazorpayOauthError);
    }
    expect(() => parseTokenResponse({ ...TOKEN_JSON, public_token: "rzp_test_abc" }, NOW)).toThrow(RazorpayOauthError);
    expect(() => parseTokenResponse(null, NOW)).toThrow(RazorpayOauthError);
  });

  it("exchangeCode posts the code with mode and never puts the secret in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(TOKEN_JSON), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = await exchangeCode({ clientId: "cid", clientSecret: "csec", mode: "test" }, "code123", "https://a/cb");
    expect(t.accountId).toBe("acc_Dhk2qDbmu6FwZH");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.razorpay.com/token");
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: "cid",
      client_secret: "csec",
      grant_type: "authorization_code",
      redirect_uri: "https://a/cb",
      code: "code123",
      mode: "test",
    });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(exchangeCode({ clientId: "c", clientSecret: "s", mode: "test" }, "bad", "https://a/cb")).rejects.toThrow(
      RazorpayOauthError,
    );
  });
});
