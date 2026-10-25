import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  AuthError: class AuthError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  requireVendorRole: vi.fn(),
}));
vi.mock("@/lib/drops-signal", () => ({ getOrderSignal: vi.fn(async () => 7) }));

import { GET } from "@/app/api/storefront-orders/signal/route";
import { auth } from "@/lib/auth";
import { BOARD_PASS_HEADER, BOARD_PASS_TTL_MS, mintBoardPass, verifyBoardPass } from "@/lib/board-pass";
import { getOrderSignal } from "@/lib/drops-signal";
import { BOARD_POLL_MS, BOARD_SIGNAL_POLL_MS } from "@/lib/menu-orders-board";
import { requireVendorRole } from "@/lib/rbac";

process.env.AUTH_SECRET ??= "test-auth-secret-for-board-pass";

const ids = { vendorId: "cmvendor123", userId: "cmuser456" };

describe("board pass", () => {
  it("round-trips the vendor and user", () => {
    expect(verifyBoardPass(mintBoardPass(ids))).toEqual(ids);
  });

  it("expires after the TTL", () => {
    const now = Date.now();
    const pass = mintBoardPass(ids, now);
    expect(verifyBoardPass(pass, now + BOARD_PASS_TTL_MS - 1_000)).toEqual(ids);
    expect(verifyBoardPass(pass, now + BOARD_PASS_TTL_MS + 1_000)).toBeNull();
  });

  it("rejects a pass whose vendor, user or expiry was changed", () => {
    const [v, u, exp, sig] = mintBoardPass(ids).split(".");
    expect(verifyBoardPass(`cmother.${u}.${exp}.${sig}`)).toBeNull();
    expect(verifyBoardPass(`${v}.cmother.${exp}.${sig}`)).toBeNull();
    expect(verifyBoardPass(`${v}.${u}.${Number(exp) + 3600}.${sig}`)).toBeNull();
  });

  it("rejects junk without throwing", () => {
    for (const junk of [null, undefined, "", "a.b.c", "a.b.1.", "x".repeat(400), "a.b.c.d.e", "a b.c.1.sig"]) {
      expect(verifyBoardPass(junk)).toBeNull();
    }
  });

  it("only polls fast because the fast check skips Postgres", () => {
    expect(BOARD_SIGNAL_POLL_MS).toBeLessThan(BOARD_POLL_MS);
    expect(BOARD_POLL_MS).toBeGreaterThan(5 * 60_000);
  });
});

describe("GET /api/storefront-orders/signal with a board pass", () => {
  beforeEach(() => vi.clearAllMocks());

  function req(pass?: string) {
    return new NextRequest("http://localhost/api/storefront-orders/signal", {
      headers: pass === undefined ? {} : { [BOARD_PASS_HEADER]: pass },
    });
  }

  it("reads the pass's vendor counter without the Postgres role check", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: ids.userId } } as never);
    const res = await GET(req(mintBoardPass(ids)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signal: 7 });
    expect(getOrderSignal).toHaveBeenCalledWith(ids.vendorId);
    expect(requireVendorRole).not.toHaveBeenCalled();
  });

  it("401s a pass minted for another user", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "cmsomeoneelse" } } as never);
    const res = await GET(req(mintBoardPass(ids)));
    expect(res.status).toBe(401);
    expect(getOrderSignal).not.toHaveBeenCalled();
  });

  it("401s a pass with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(req(mintBoardPass(ids)))).status).toBe(401);
  });

  it("401s a forged pass without asking for the session", async () => {
    expect((await GET(req("cmvendor123.cmuser456.9999999999.AAAA"))).status).toBe(401);
    expect(auth).not.toHaveBeenCalled();
  });

  it("falls back to the full role check without a pass", async () => {
    vi.mocked(requireVendorRole).mockResolvedValue({ vendor: { id: "cmviarbac" } } as never);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(getOrderSignal).toHaveBeenCalledWith("cmviarbac");
  });
});
