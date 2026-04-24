import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = {
  incrby: vi.fn(),
  ttl: vi.fn(),
  expire: vi.fn(),
};

vi.mock("@/lib/kv", () => ({
  getKv: () => redisMock,
}));

import { reserveAnthropicTokens, reserveSarvamMinutes } from "@/lib/ai-usage-guard";

describe("ai-usage-guard", () => {
  beforeEach(() => {
    redisMock.incrby.mockReset();
    redisMock.ttl.mockReset();
    redisMock.expire.mockReset();
    delete process.env.GLOBAL_ANTHROPIC_MONTHLY_TOKEN_CAP;
    delete process.env.GLOBAL_SARVAM_MONTHLY_MINUTE_CAP;
  });

  it("allows anthropic usage below vendor and global caps", async () => {
    redisMock.incrby.mockResolvedValueOnce(10_000).mockResolvedValueOnce(100_000);
    redisMock.ttl.mockResolvedValue(-1);
    redisMock.expire.mockResolvedValue(1);
    const out = await reserveAnthropicTokens({
      vendorId: "v1",
      plan: "STARTER",
      estimatedTokens: 10_000,
    });
    expect(out.ok).toBe(true);
  });

  it("denies when vendor anthropic monthly cap is exceeded", async () => {
    // STARTER cap = 2,000,000
    redisMock.incrby.mockResolvedValueOnce(2_100_000).mockResolvedValueOnce(2_100_000);
    redisMock.ttl.mockResolvedValue(100);
    const out = await reserveAnthropicTokens({
      vendorId: "v1",
      plan: "STARTER",
      estimatedTokens: 100_000,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("vendor_anthropic_cap_reached");
  });

  it("denies when global anthropic cap is exceeded", async () => {
    process.env.GLOBAL_ANTHROPIC_MONTHLY_TOKEN_CAP = "1000";
    redisMock.incrby.mockResolvedValueOnce(100).mockResolvedValueOnce(2000);
    redisMock.ttl.mockResolvedValue(100);
    const out = await reserveAnthropicTokens({
      vendorId: "v1",
      plan: "PRO",
      estimatedTokens: 100,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("global_anthropic_cap_reached");
  });

  it("allows sarvam minutes under cap", async () => {
    redisMock.incrby.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    redisMock.ttl.mockResolvedValue(100);
    const out = await reserveSarvamMinutes({
      vendorId: "v1",
      plan: "STARTER",
      estimatedMinutes: 5,
    });
    expect(out.ok).toBe(true);
  });

  it("denies sarvam on FREE plan (cap 0)", async () => {
    redisMock.incrby.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    redisMock.ttl.mockResolvedValue(100);
    const out = await reserveSarvamMinutes({
      vendorId: "v1",
      plan: "FREE",
      estimatedMinutes: 1,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("vendor_sarvam_cap_reached");
  });

  it("fails open if redis is unavailable", async () => {
    redisMock.incrby.mockRejectedValue(new Error("redis down"));
    const out = await reserveAnthropicTokens({
      vendorId: "v1",
      plan: "STARTER",
      estimatedTokens: 10_000,
    });
    expect(out.ok).toBe(true);
  });
});

