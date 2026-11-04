/**
 * Keep stores on the price they were told at sign-up, after a list price rises.
 * Gives each one its own price (`Vendor.customPricePaise`, lib/subscription.ts).
 *
 *   npm run billing:keep-signup-price                                      # dry run: prints the count
 *   npm run billing:keep-signup-price -- --apply --allow-remote            # writes it
 *   npm run billing:keep-signup-price -- --before=2026-11-04T15:00:00Z     # signed up before this (default: now)
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

/** ₹299 before GST: the Starter price until 2026-11-04. */
const SIGNUP_PRICE_PAISE = 29900;

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
  if (!arg) return new Date();
  const before = new Date(arg.slice("--before=".length));
  if (Number.isNaN(before.getTime())) throw new Error("--before must be a date, like 2026-11-04T15:00:00Z");
  return before;
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
  const where = { isDemo: false, customPricePaise: null, createdAt: { lt: before } };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const count = await prisma.vendor.count({ where });
    console.log(`${count} stores signed up before ${before.toISOString()} have no price of their own.`);
    if (!apply) {
      console.log("Dry run: nothing written. Pass --apply to set them to ₹299.");
      return;
    }
    const { count: updated } = await prisma.vendor.updateMany({ where, data: { customPricePaise: SIGNUP_PRICE_PAISE } });
    console.log(`Set ${updated} stores to ₹299 a month before GST.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("Failed:", err instanceof Error ? err.message : "unknown");
  process.exit(1);
});
