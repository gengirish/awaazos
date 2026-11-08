/**
 * Demo-store banner/logo (lib/demo-store-image.ts) — DB integration test. Runs
 * only with DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production);
 * `npm run test:drops:db`.
 *
 * No Blob token in tests, so uploads stop at the 503 after validation; the
 * scoping rules (unknown ref, claimed store, audit row) are what is checked.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";

vi.hoisted(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

const TAG = randomBytes(4).toString("hex");
const ACTOR = `admin:test-${TAG}`;

describe.skipIf(!ENABLED)("demo-store images — DB integration", () => {
  let prisma: PrismaClient;
  let images: typeof import("@/lib/demo-store-image");
  let demo: typeof import("@/lib/demo-store");
  let schema: typeof import("@/lib/demo-store-schema");
  const ownerEmail = `demo-owner-img-${TAG}@example.test`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("demo-store-image.db.test refuses to run against a non-local DATABASE_URL");
    }
    process.env.DEMO_OWNER_EMAIL = ownerEmail;
    ({ prisma } = await import("@/lib/prisma"));
    images = await import("@/lib/demo-store-image");
    demo = await import("@/lib/demo-store");
    schema = await import("@/lib/demo-store-schema");
  });

  afterAll(async () => {
    if (!prisma) return;
    const vendors = await prisma.vendor.findMany({
      where: { demoExternalRef: { startsWith: `i${TAG}-` } },
      select: { id: true },
    });
    const ids = vendors.map((v) => v.id);
    await prisma.receipt.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await prisma.demoAuditLog.deleteMany({ where: { externalRef: { startsWith: `i${TAG}-` } } });
    await prisma.$disconnect();
  });

  const ref = (name: string) => `i${TAG}-${name}`;

  async function makeDemo(name: string) {
    const input = schema.demoStoreCreateSchema.parse({
      external_ref: ref(name),
      profile: { name: `Img ${name}` },
      items: [{ name: "Brownie", price_paise: 8_000 }],
    });
    await demo.createDemoStore(input, ACTOR);
    return prisma.vendor.findUniqueOrThrow({ where: { demoExternalRef: ref(name) }, select: { id: true } });
  }

  function upload(type: string, bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])): Request {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type }), "x");
    return new Request("http://localhost/x", { method: "POST", body: form });
  }

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return "ok";
    } catch (e) {
      return e instanceof demo.DemoStoreError ? `${e.status} ${e.code}` : (e as Error).constructor.name;
    }
  }

  it("unknown ref is not_found; a claimed store is refused", async () => {
    expect(await code(images.removeDemoStoreImage(ref("nope"), "logo", ACTOR))).toBe("404 not_found");
    const v = await makeDemo("claimed");
    await prisma.vendor.update({ where: { id: v.id }, data: { isDemo: false } });
    expect(await code(images.removeDemoStoreImage(ref("claimed"), "banner", ACTOR))).toBe("409 not_a_demo_store");
    expect(await code(images.setDemoStoreImage(upload("image/png"), ref("claimed"), "banner", ACTOR))).toBe(
      "409 not_a_demo_store",
    );
  });

  it("validates the upload before asking for Blob storage", async () => {
    await makeDemo("upload");
    expect(await code(images.setDemoStoreImage(upload("image/gif"), ref("upload"), "logo", ACTOR))).toBe(
      "ImageUploadError",
    );
    expect(await code(images.setDemoStoreImage(upload("image/png"), ref("upload"), "logo", ACTOR))).toBe(
      "503 image_uploads_unavailable",
    );
  });

  it("removing clears the column and writes an audit row", async () => {
    const v = await makeDemo("remove");
    expect(await code(images.removeDemoStoreImage(ref("remove"), "logo", ACTOR))).toBe("ok");
    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, select: { logoUrl: true } });
    expect(row.logoUrl).toBeNull();
    const audit = await prisma.demoAuditLog.findMany({ where: { externalRef: ref("remove"), action: "image" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe(ACTOR);

    // With a picture stored but no Blob token, nothing is cleared (the blob would be orphaned).
    await prisma.vendor.update({ where: { id: v.id }, data: { logoUrl: "https://blob.example/logo.png" } });
    expect(await code(images.removeDemoStoreImage(ref("remove"), "logo", ACTOR))).toBe(
      "503 image_uploads_unavailable",
    );
    const kept = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id }, select: { logoUrl: true } });
    expect(kept.logoUrl).toBe("https://blob.example/logo.png");
  });
});
