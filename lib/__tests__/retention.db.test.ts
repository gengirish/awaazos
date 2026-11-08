/**
 * Retention through the real cron route and Prisma deletes. Runs only with
 * DROPS_DB_TEST=1 against a THROWAWAY Postgres (never production); see
 * lib/__tests__/drops.db.test.ts for the recipe, or `npm run test:drops:db`.
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.DROPS_DB_TEST === "1";
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = "a-long-enough-test-secret";

describe.skipIf(!ENABLED)("retention — DB integration", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let vendorId = "";

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      throw new Error("retention.db.test refuses to run against a non-local DATABASE_URL");
    }
    ({ prisma } = await import("@/lib/prisma"));
    const tag = randomBytes(5).toString("hex");
    const vendor = await prisma.vendor.create({
      data: { slug: `retention-test-${tag}`, name: `Retention Test ${tag}`, ownerName: "Owner" },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.voiceParseLog.deleteMany({ where: { vendorId } });
    await prisma.receipt.deleteMany({ where: { vendorId } });
    await prisma.transaction.deleteMany({ where: { vendorId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.$disconnect();
  });

  function voiceLog(ageDays: number) {
    return prisma.voiceParseLog.create({
      data: {
        vendorId,
        transcript: "do samosa",
        lang: "en-IN",
        sttSource: "webspeech",
        modelUsed: "claude-haiku-4-5",
        itemCount: 1,
        confidence: "high",
        latencyMs: 100,
        createdAt: new Date(Date.now() - ageDays * DAY_MS),
      },
    });
  }

  async function receipt(ageDays: number) {
    const createdAt = new Date(Date.now() - ageDays * DAY_MS);
    const bill = `AWZ-TEST-${randomBytes(4).toString("hex")}`;
    const tx = await prisma.transaction.create({
      data: { vendorId, billNumber: bill, subtotalPaise: 2000, totalPaise: 2000, createdAt },
    });
    return prisma.receipt.create({ data: { transactionId: tx.id, vendorId, receiptNumber: bill, createdAt } });
  }

  async function runCron(auth?: string) {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/retention/route");
    return GET(
      new Request("http://x.test/api/cron/retention", auth ? { headers: { authorization: auth } } : undefined),
    );
  }

  it("refuses a missing or wrong secret and deletes nothing", async () => {
    const old = await voiceLog(120);
    expect((await runCron()).status).toBe(401);
    expect((await runCron("Bearer wrong")).status).toBe(401);
    expect(await prisma.voiceParseLog.findUnique({ where: { id: old.id } })).not.toBeNull();
  });

  it("deletes voice logs past 90 days and receipts past 7 years, and keeps the rest", async () => {
    const [oldLog, freshLog] = await Promise.all([voiceLog(91), voiceLog(89)]);
    const [oldReceipt, freshReceipt] = await Promise.all([receipt(7 * 366 + 2), receipt(6 * 365)]);

    const res = await runCron(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { voiceLogsDeleted: number; receiptsDeleted: number } };
    expect(body.data.voiceLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(body.data.receiptsDeleted).toBeGreaterThanOrEqual(1);

    expect(await prisma.voiceParseLog.findUnique({ where: { id: oldLog.id } })).toBeNull();
    expect(await prisma.voiceParseLog.findUnique({ where: { id: freshLog.id } })).not.toBeNull();
    expect(await prisma.receipt.findUnique({ where: { id: oldReceipt.id } })).toBeNull();
    expect(await prisma.receipt.findUnique({ where: { id: freshReceipt.id } })).not.toBeNull();
    // The bill itself stays: only the receipt row has a retention limit.
    expect(await prisma.transaction.count({ where: { vendorId } })).toBe(2);

    const again = (await (await runCron(`Bearer ${SECRET}`)).json()) as { data: { voiceLogsDeleted: number } };
    expect(again.data.voiceLogsDeleted).toBe(0);
  });
});
