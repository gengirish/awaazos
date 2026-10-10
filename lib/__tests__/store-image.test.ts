/**
 * Store banner / logo upload (lib/store-image.ts, lib/blob-image.ts) and the
 * browser downscale maths (lib/image-downscale.ts). Auth, Prisma and Vercel
 * Blob are mocked — no DB, no network.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "OWNER" as "OWNER" | "MANAGER" | null,
  token: "blob-token" as string | undefined,
  vendor: { id: "v_1", bannerUrl: null as string | null, logoUrl: null as string | null },
  put: vi.fn(),
  del: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    get BLOB_READ_WRITE_TOKEN() {
      return h.token;
    },
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
  return {
    AuthError,
    requireVendorRole: async (minRole: string) => {
      if (!h.role) throw new AuthError(401, "Unauthorized");
      if (minRole === "OWNER" && h.role !== "OWNER") throw new AuthError(403, "Requires staff role OWNER or higher.");
      return { vendor: h.vendor, setVendorCookie: null };
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { vendor: { update: h.update } } }));
vi.mock("@vercel/blob", () => ({ put: h.put, del: h.del }));
// drops-api pulls in lib/drops; only the cookie helper is needed here.
vi.mock("@/lib/drops-api", () => ({ withVendorCookie: (res: unknown) => res }));

import { IMAGE_MAX_BYTES } from "@/lib/blob-image";
import { fitWithin } from "@/lib/image-downscale";
import { removeStoreImage, uploadStoreImage } from "@/lib/store-image";

function upload(file: Blob | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  if (file) body.append("file", file, "photo");
  return new NextRequest("http://localhost/api/vendor/banner", { method: "POST", body, headers });
}

const jpeg = (bytes = 10) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
const del = () => new NextRequest("http://localhost/api/vendor/banner", { method: "DELETE" });

beforeEach(() => {
  h.role = "OWNER";
  h.token = "blob-token";
  h.vendor = { id: "v_1", bannerUrl: null, logoUrl: null };
  h.put.mockReset().mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/store/v_1/banner-abc.jpg" });
  h.del.mockReset().mockResolvedValue(undefined);
  h.update.mockReset().mockResolvedValue({});
});

describe("uploadStoreImage", () => {
  it("stores the banner under the vendor's path and saves the URL", async () => {
    const res = await uploadStoreImage(upload(jpeg()), "banner");
    expect(res.status).toBe(200);
    expect((await res.json()).data.url).toContain("/store/v_1/banner-abc.jpg");
    expect(h.put.mock.calls[0][0]).toBe("store/v_1/banner.jpg");
    expect(h.put.mock.calls[0][2]).toMatchObject({ access: "public", addRandomSuffix: true, contentType: "image/jpeg" });
    expect(h.update).toHaveBeenCalledWith({ where: { id: "v_1" }, data: { bannerUrl: expect.any(String) } });
    expect(h.del).not.toHaveBeenCalled();
  });

  it("writes logoUrl for the logo and deletes the previous blob", async () => {
    h.vendor.logoUrl = "https://x.public.blob.vercel-storage.com/old-logo.png";
    const res = await uploadStoreImage(upload(new Blob([new Uint8Array(4)], { type: "image/png" })), "logo");
    expect(res.status).toBe(200);
    expect(h.put.mock.calls[0][0]).toBe("store/v_1/logo.png");
    expect(h.update.mock.calls[0][0].data).toHaveProperty("logoUrl");
    expect(h.del).toHaveBeenCalledWith(h.vendor.logoUrl, { token: "blob-token" });
  });

  it("is owner-only", async () => {
    h.role = "MANAGER";
    expect((await uploadStoreImage(upload(jpeg()), "banner")).status).toBe(403);
    h.role = null;
    expect((await uploadStoreImage(upload(jpeg()), "banner")).status).toBe(401);
    expect(h.put).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing file", null, {}, "Missing file"],
    ["an unsupported type", new Blob(["x"], { type: "image/gif" }), {}, "Unsupported image type. Use JPEG, PNG or WebP."],
    ["an empty file", new Blob([], { type: "image/png" }), {}, "Image is empty"],
    ["an oversized file", jpeg(IMAGE_MAX_BYTES + 1), {}, "Image must be 4MB or smaller"],
    ["an oversized declared length", jpeg(), { "content-length": String(IMAGE_MAX_BYTES + 1) }, "Image must be 4MB or smaller"],
  ])("rejects %s before touching Blob", async (_name, file, headers, error) => {
    const res = await uploadStoreImage(upload(file, headers), "banner");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("returns 503 when Blob is not configured", async () => {
    h.token = undefined;
    const res = await uploadStoreImage(upload(jpeg()), "banner");
    expect(res.status).toBe(503);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("removes the new blob when the row can't be written", async () => {
    h.update.mockRejectedValue(new Error("db down"));
    const res = await uploadStoreImage(upload(jpeg()), "banner");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
    expect(h.del).toHaveBeenCalledWith(expect.stringContaining("banner-abc.jpg"), { token: "blob-token" });
  });

  it("still succeeds when deleting the old blob fails", async () => {
    h.vendor.bannerUrl = "https://x.public.blob.vercel-storage.com/old.jpg";
    h.del.mockRejectedValue(new Error("blob 500"));
    expect((await uploadStoreImage(upload(jpeg()), "banner")).status).toBe(200);
  });
});

describe("removeStoreImage", () => {
  it("clears the field and deletes the blob", async () => {
    h.vendor.bannerUrl = "https://x.public.blob.vercel-storage.com/old.jpg";
    const res = await removeStoreImage(del(), "banner");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.update).toHaveBeenCalledWith({ where: { id: "v_1" }, data: { bannerUrl: null } });
    expect(h.del).toHaveBeenCalledWith("https://x.public.blob.vercel-storage.com/old.jpg", { token: "blob-token" });
  });

  it("is a no-op success when nothing is set, even without a token", async () => {
    h.token = undefined;
    expect((await removeStoreImage(del(), "logo")).status).toBe(200);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("refuses to orphan a blob when the token is missing", async () => {
    h.token = undefined;
    h.vendor.bannerUrl = "https://x.public.blob.vercel-storage.com/old.jpg";
    expect((await removeStoreImage(del(), "banner")).status).toBe(503);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("is owner-only", async () => {
    h.role = "MANAGER";
    expect((await removeStoreImage(del(), "banner")).status).toBe(403);
  });
});

describe("fitWithin", () => {
  it("scales a phone photo down to the banner width, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 1600, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 300, 1600, 1600)).toEqual({ width: 800, height: 300 });
  });

  it("keeps at least one pixel and handles bad input", () => {
    expect(fitWithin(10000, 1, 512, 512)).toEqual({ width: 512, height: 1 });
    expect(fitWithin(0, 100, 512, 512)).toEqual({ width: 0, height: 0 });
  });
});
