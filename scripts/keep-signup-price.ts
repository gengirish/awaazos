/**
 * Keep stores on the price they were told at sign-up, after a list price rises.
 * Gives each one its own price (`Vendor.customPricePaise`, lib/subscription.ts).
 *
 *   npm run billing:keep-signup-price -- --price=299 --before=2026-11-04T16:47:34Z                  # dry run: prints the count
 *   npm run billing:keep-signup-price -- --price=299 --before=2026-11-04T16:47:34Z --apply --allow-remote  # writes it
 *
 * List prices have changed more than once, so both are required. Run the oldest
 * price first: a later run skips the stores an earlier one priced.
 *   299: signed up before 2026-11-04T16:47:34Z (when the list price became 499, #135)
 *   499: signed up before the deploy that makes it 649
 *
 * Skips demo stores and any store that already has its own price, so running it
 * twice changes nothing new. A live subscription keeps the price it was made at.
 * A store with its own price is offered Starter only.
 *
 * Only local databases unless `--allow-remote` is passed. Prints counts, never a
 * store's details. Reads DATABASE_URL from the environment, else .env.local / .env.
 */
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { isValidCustomPriceRupees } from "../lib/subscription";

function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    const m = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m.exec(fs.readFileSync(file, "utf8"));
    if (m) return m[1].replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

function beforeArg(): Date {
  const arg = process.argv.find((a) => a.startsWith("--before="));
  if (!arg) throw new Error("--before is required, like --before=2026-11-04T16:47:34Z");
  const before = new Date(arg.slice("--before=".length));
  if (Number.isNaN(before.getTime())) throw new Error("--before must be a date, like 2026-11-04T15:00:00Z");
  return before;
}

function priceArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--price="));
  const rupees = Number(arg?.slice("--price=".length));
  if (!arg || !isValidCustomPriceRupees(rupees)) throw new Error("--price is required: whole rupees before GST, like --price=299");
  return rupees;
}

async function main(): Promise<void> {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  const apply = process.argv.includes("--apply");
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (apply && !isLocal && !process.argv.includes("--allow-remote")) {
    throw new Error("Not a local database: read the dry run, then pass --allow-remote");
  }

  const before = beforeArg();
  const rupees = priceArg();
  const where = { isDemo: false, customPricePaise: null, createdAt: { lt: before } };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const count = await prisma.vendor.count({ where });
    console.log(`${count} stores signed up before ${before.toISOString()} have no price of their own.`);
    if (!apply) {
      console.log(`Dry run: nothing written. Pass --apply to set them to ₹${rupees}.`);
      return;
    }
    const { count: updated } = await prisma.vendor.updateMany({ where, data: { customPricePaise: rupees * 100 } });
    console.log(`Set ${updated} stores to ₹${rupees} a month before GST.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("Failed:", err instanceof Error ? err.message : "unknown");
  process.exit(1);
});
