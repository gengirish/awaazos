import { describe, expect, it } from "vitest";

import { isSessionStale } from "@/lib/session-freshness";

describe("isSessionStale", () => {
  const changedAt = new Date("2026-11-09T10:00:00Z");
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);

  it("is stale when the token was issued before the password change", () => {
    expect(isSessionStale(changedAt, sec(changedAt) - 60)).toBe(true);
  });

  it("is fresh when issued after the change, or within 5 s of skew", () => {
    expect(isSessionStale(changedAt, sec(changedAt) + 1)).toBe(false);
    expect(isSessionStale(changedAt, sec(changedAt) - 4)).toBe(false);
  });

  it("never locks out an account that has not reset, or a token without iat", () => {
    expect(isSessionStale(null, sec(changedAt) - 3600)).toBe(false);
    expect(isSessionStale(changedAt, undefined)).toBe(false);
  });
});
