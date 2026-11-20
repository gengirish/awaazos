import { describe, expect, it } from "vitest";

import {
  canonicalHostFrom,
  flagOn,
  isLegacyHost,
  legacyHostRedirect,
  normaliseHost,
  storeWebsiteHost,
} from "../canonical-host";

const NEW = "awaazdo.store";
const OLD = "awaazos.intelliforge.tech";

function redirect(over: Partial<Parameters<typeof legacyHostRedirect>[0]> = {}) {
  return legacyHostRedirect({
    host: OLD,
    method: "GET",
    pathname: "/s/sam-store",
    search: "",
    canonicalHost: NEW,
    redirectPos: false,
    ...over,
  });
}

describe("normaliseHost / canonicalHostFrom", () => {
  it("lowercases and drops a port or trailing dot", () => {
    expect(normaliseHost("AwaazDo.Store:443")).toBe(NEW);
    expect(normaliseHost("awaazdo.store.")).toBe(NEW);
  });

  it("rejects anything that isn't a plain hostname", () => {
    for (const bad of ["", "  ", "https://awaazdo.store", "awaazdo.store/s", "localhost", "a b.com", undefined, null]) {
      expect(normaliseHost(bad)).toBeNull();
    }
  });

  it("leaves the move off when CANONICAL_HOST is unset or garbage", () => {
    expect(canonicalHostFrom(undefined)).toBeNull();
    expect(canonicalHostFrom("https://awaazdo.store/")).toBeNull();
    expect(canonicalHostFrom(" awaazdo.store ")).toBe(NEW);
  });
});

describe("isLegacyHost", () => {
  it("is true only for a known old host while a move is on", () => {
    expect(isLegacyHost(OLD, NEW)).toBe(true);
    expect(isLegacyHost("awaazos.vercel.app", NEW)).toBe(true);
    expect(isLegacyHost(NEW, NEW)).toBe(false);
    expect(isLegacyHost("localhost:3000", NEW)).toBe(false);
    expect(isLegacyHost("some-other.example", NEW)).toBe(false);
    expect(isLegacyHost(OLD, null)).toBe(false);
  });
});

describe("legacyHostRedirect", () => {
  it("does nothing until CANONICAL_HOST is set", () => {
    expect(redirect({ canonicalHost: null })).toBeNull();
  });

  it("sends a page on the old host to the same path and query on the new one", () => {
    expect(redirect({ search: "?src=ig" })).toBe("https://awaazdo.store/s/sam-store?src=ig");
    expect(redirect({ pathname: "/", search: "" })).toBe("https://awaazdo.store/");
    expect(redirect({ pathname: "/sign-in", search: "?callbackUrl=%2Forders" })).toBe(
      "https://awaazdo.store/sign-in?callbackUrl=%2Forders",
    );
    expect(redirect({ host: "AWAAZOS.INTELLIFORGE.TECH:443", pathname: "/orders" })).toBe("https://awaazdo.store/orders");
    expect(redirect({ method: "head" })).not.toBeNull();
  });

  it("never redirects on the new host or an unknown one", () => {
    expect(redirect({ host: NEW })).toBeNull();
    expect(redirect({ host: "localhost:3100" })).toBeNull();
    expect(redirect({ host: null })).toBeNull();
  });

  it("keeps serving APIs on the old host: webhooks, outbox POSTs, crons, probes", () => {
    for (const pathname of [
      "/api/webhooks/razorpay-orders/v1",
      "/api/webhooks/razorpay-partner",
      "/api/transactions",
      "/api/cron/retention",
      "/api/health",
      "/api",
    ]) {
      expect(redirect({ pathname })).toBeNull();
    }
  });

  it("keeps serving the files old installs fetch", () => {
    for (const pathname of [
      "/sw.js",
      "/offline.html",
      "/manifest.webmanifest",
      "/icon-192.png",
      "/_next/static/chunks/x.js",
      "/s/sam-store/manifest.webmanifest",
      "/s/sam-store/app-icon/192",
    ]) {
      expect(redirect({ pathname })).toBeNull();
    }
    // A product link under a store is a page, not an app file.
    expect(redirect({ pathname: "/s/sam-store/p/abc" })).toBe("https://awaazdo.store/s/sam-store/p/abc");
  });

  it("never redirects a POST (server actions post to the page path)", () => {
    expect(redirect({ method: "POST", pathname: "/orders" })).toBeNull();
  });

  it("keeps /pos on the old host until its own flag is on, so queued sales sync", () => {
    expect(redirect({ pathname: "/pos" })).toBeNull();
    expect(redirect({ pathname: "/pos/anything" })).toBeNull();
    expect(redirect({ pathname: "/pos", redirectPos: true })).toBe("https://awaazdo.store/pos");
    expect(redirect({ pathname: "/postcard" })).toBe("https://awaazdo.store/postcard");
  });
});

describe("flagOn", () => {
  it("reads 1 / true only", () => {
    expect(flagOn("1")).toBe(true);
    expect(flagOn(" TRUE ")).toBe(true);
    for (const v of [undefined, "", "0", "false", "yes"]) expect(flagOn(v)).toBe(false);
  });
});

describe("storeWebsiteHost", () => {
  it("is the canonical host once the move is on", () => {
    expect(storeWebsiteHost(" AwaazDo.Store ", "https://awaazos.intelliforge.tech")).toBe(NEW);
  });

  it("falls back to the app's own origin", () => {
    expect(storeWebsiteHost(undefined, "https://awaazos.intelliforge.tech/")).toBe(OLD);
  });

  it("is null for localhost or a bad URL", () => {
    expect(storeWebsiteHost(undefined, "http://localhost:3000")).toBeNull();
    expect(storeWebsiteHost("", "not a url")).toBeNull();
  });
});
