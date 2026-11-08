/**
 * "Connect Razorpay": the seller authorises AwaazOS's Razorpay Technology Partner
 * app on Razorpay, and we get an access token for HER account. Money still
 * settles into her own Razorpay balance — this is OAuth access to her account,
 * not the aggregator / sub-merchant model, and the platform RAZORPAY_* keys are
 * never involved.
 *
 * Server-only. Endpoints and token shape from Razorpay's partner OAuth docs:
 *   authorize  GET  https://auth.razorpay.com/authorize
 *   token      POST https://auth.razorpay.com/token   (code or refresh_token)
 *   revoke     POST https://auth.razorpay.com/revoke
 * Access tokens last ~90 days, refresh tokens 180 days, and refresh tokens
 * ROTATE: issuing a new one kills the old one (see refreshVendorTokens' lock in
 * lib/storefront-razorpay.ts).
 *
 * Never log tokens, the client secret, the auth code or the state.
 */

import crypto from "node:crypto";

import { requireEnv } from "@/lib/env";
import { withTimeout } from "@/lib/with-timeout";

const AUTH_BASE = "https://auth.razorpay.com";
const TIMEOUT_MS = 8_000;
const STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh tokens live 180 days; treat them as dead a day early. */
const REFRESH_TOKEN_LIFETIME_MS = 179 * 24 * 60 * 60 * 1000;

export const OAUTH_STATE_COOKIE = "awz_rzp_oauth";
export const OAUTH_STATE_MAX_AGE_S = STATE_TTL_MS / 1000;

export type OauthMode = "test" | "live";

export type RazorpayOauthConfig = { clientId: string; clientSecret: string; mode: OauthMode };

/** Null when the partner app isn't set up on this deploy (Connect stays hidden). */
export function razorpayOauthConfig(): RazorpayOauthConfig | null {
  const clientId = process.env.RAZORPAY_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.RAZORPAY_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  // Anything but an explicit "live" is test mode: a typo must not take real money.
  const mode: OauthMode = process.env.RAZORPAY_OAUTH_MODE?.trim().toLowerCase() === "live" ? "live" : "test";
  return { clientId, clientSecret, mode };
}

export function isRazorpayOauthConfigured(): boolean {
  return razorpayOauthConfig() !== null;
}

/** Where Razorpay sends the seller back. Must be whitelisted on the partner app. */
export function oauthRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/vendor/payments/razorpay/callback`;
}

export function authorizeUrl(cfg: RazorpayOauthConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "read_write",
    state,
  });
  return `${AUTH_BASE}/authorize?${q.toString()}`;
}

// ─── State (CSRF) ───────────────────────────────────────────────────

type StatePayload = { v: string; n: string; e: number };

function stateKey(): string {
  return `razorpay-oauth-state:${requireEnv("AUTH_SECRET")}`;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", stateKey()).update(data, "utf8").digest("base64url");
}

/**
 * `state` = base64url(JSON{ vendorId, nonce, expiry }) + "." + HMAC. The nonce
 * also goes in an httpOnly cookie, so a state minted in one browser can't be
 * completed in another.
 */
export function createOauthState(vendorId: string, now: Date = new Date()): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const payload: StatePayload = { v: vendorId, n: nonce, e: now.getTime() + STATE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { state: `${body}.${sign(body)}`, nonce };
}

/** The vendor id the state was minted for, or null if forged, expired or not this browser's. */
export function readOauthState(
  state: string | null | undefined,
  cookieNonce: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!state || !cookieNonce || state.length > 1024) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: Partial<StatePayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StatePayload>;
  } catch {
    return null;
  }
  if (typeof payload.v !== "string" || typeof payload.n !== "string" || typeof payload.e !== "number") return null;
  if (payload.e < now.getTime()) return null;
  const n1 = Buffer.from(payload.n, "utf8");
  const n2 = Buffer.from(cookieNonce, "utf8");
  if (n1.length !== n2.length || !crypto.timingSafeEqual(n1, n2)) return null;
  return payload.v;
}

// ─── Tokens ─────────────────────────────────────────────────────────

export type OauthTokens = {
  accessToken: string;
  refreshToken: string;
  publicToken: string;
  accountId: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export class RazorpayOauthError extends Error {
  constructor(
    public readonly status: number,
    public readonly op: string,
  ) {
    // No response body: it can echo the code or a token.
    super(`Razorpay OAuth ${op} failed with HTTP ${status}`);
    this.name = "RazorpayOauthError";
  }
}

const PUBLIC_TOKEN_RE = /^rzp_(live|test)_oauth_[A-Za-z0-9]{6,64}$/;
const ACCOUNT_ID_RE = /^acc_[A-Za-z0-9]{6,40}$/;

export function publicTokenMode(publicToken: string): OauthMode {
  return publicToken.startsWith("rzp_live_") ? "live" : "test";
}

/** Razorpay's token response → our shape. Throws on anything missing or malformed. */
export function parseTokenResponse(json: unknown, now: Date = new Date()): OauthTokens {
  const o = (json ?? {}) as Record<string, unknown>;
  const accessToken = typeof o.access_token === "string" ? o.access_token : "";
  const refreshToken = typeof o.refresh_token === "string" ? o.refresh_token : "";
  const publicToken = typeof o.public_token === "string" ? o.public_token : "";
  const accountId = typeof o.razorpay_account_id === "string" ? o.razorpay_account_id : "";
  const expiresIn = typeof o.expires_in === "number" && Number.isFinite(o.expires_in) ? o.expires_in : 0;
  if (
    accessToken.length < 16 ||
    refreshToken.length < 16 ||
    !PUBLIC_TOKEN_RE.test(publicToken) ||
    !ACCOUNT_ID_RE.test(accountId) ||
    expiresIn <= 0
  ) {
    throw new RazorpayOauthError(502, "token.parse");
  }
  return {
    accessToken,
    refreshToken,
    publicToken,
    accountId,
    accessExpiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
  };
}

async function postAuth(path: string, op: string, body: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const run = async () => {
    const res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const ok = res.status >= 200 && res.status < 300;
    return { status: res.status, json: ok ? ((await res.json()) as unknown) : null };
  };
  try {
    return await withTimeout(run(), TIMEOUT_MS, `razorpay-oauth.${op}`);
  } finally {
    controller.abort();
  }
}

export async function exchangeCode(cfg: RazorpayOauthConfig, code: string, redirectUri: string): Promise<OauthTokens> {
  const { status, json } = await postAuth("/token", "token.code", {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
    mode: cfg.mode,
  });
  if (status < 200 || status >= 300) throw new RazorpayOauthError(status, "token.code");
  return parseTokenResponse(json);
}

export async function refreshTokens(cfg: RazorpayOauthConfig, refreshToken: string): Promise<OauthTokens> {
  const { status, json } = await postAuth("/token", "token.refresh", {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (status < 200 || status >= 300) throw new RazorpayOauthError(status, "token.refresh");
  return parseTokenResponse(json);
}

/** Best effort: the seller is disconnected on our side whatever Razorpay answers. */
export async function revokeToken(cfg: RazorpayOauthConfig, token: string, hint: "access_token" | "refresh_token"): Promise<boolean> {
  try {
    const { status } = await postAuth("/revoke", "revoke", {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      token,
      token_type_hint: hint,
    });
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}
