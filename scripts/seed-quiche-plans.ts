/**
 * Seed the two quiche plans for a test store (lib/offers.ts).
 *
 *   npm run seed:quiche-plans -- <store-slug>            # dry run: prints what it would write
 *   npm run seed:quiche-plans -- <store-slug> --create   # writes it
 *
 * Creates (or updates, matched by name) five quiche flavours tagged `quiche`
 * (the two paneer ones also `paneer`), a Bhel Puri that no plan covers, and:
 *
 *   Weekly Plan         4+ quiches incl. 1 paneer → 10% off
 *   Family Weekly Plan  6+ quiches incl. 2 paneer → 12% off
 *
 * Idempotent: run it twice and nothing is duplicated. It only ever touches the
 * one store named on the command line, and only local databases unless
 * `--allow-remote` is passed — this writes rows, so read the dry run first.
 *
 * Reads DATABASE_URL from the environment, else from .env.local / .env.
 */
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const QUICHES = [
  { name: "Potato Corn Capsicum Quiche", rupees: 55, tags: ["quiche"] },
  { name: "Raw Banana Corn Zucchini Quiche", rupees: 65, tags: ["quiche"] },
  { name: "Paneer Carrot Zucchini Quiche", rupees: 100, tags: ["quiche", "paneer"] },
  { name: "Paneer Broccoli Zucchini Quiche", rupees: 110, tags: ["quiche", "paneer"] },
  { name: "Potato Spinach Peas Quiche", rupees: 60, tags: ["quiche"] },
] as const;

const OTHER_ITEMS = [{ name: "Bhel Puri", rupees: 40, tags: ["snacks"], category: "Snacks" }] as const;

const PLANS = [
  {
    name: "Weekly Plan",
    description: "Any 4 quiches with at least 1 paneer.",
    minQty: 4,
    requiredTagQty: 1,
    percentBps: 1000,
  },
  {
    name: "Family Weekly Plan",
    description: "Any 6 quiches with at least 2 paneer.",
    minQty: 6,
    requiredTagQty: 2,
    percentBps: 1200,
  },
] as const;

function loadEnvFile(name: string): void {
  const file = path.join(process.cwd(), name);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const create = args.includes("--create");
  const allowRemote = args.includes("--allow-remote");
  if (!slug) {
    console.error("Usage: npm run seed:quiche-plans -- <store-slug> [--create] [--allow-remote]");
    process.exit(1);
  }

  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const local = host === "localhost" || host === "127.0.0.1";
  if (!local && !allowRemote) {
    console.error(`Refusing to seed a non-local database (${host || "unknown host"}). Pass --allow-remote to do it on purpose.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const vendor = await prisma.vendor.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!vendor) {
      console.error(`No store with the slug "${slug}".`);
      process.exit(1);
    }
    console.log(`${create ? "Seeding" : "Dry run for"} ${vendor.name} (/s/${slug}) on ${host}`);

    const items = [
      ...QUICHES.map((q) => ({ ...q, category: "Snacks" })),
      ...OTHER_ITEMS.map((o) => ({ ...o })),
    ];
    for (const it of items) {
      const priceInPaise = it.rupees * 100;
      // Compound scope: only ever this store's row of that name.
      const existing = await prisma.menuItem.findFirst({
        where: { vendorId: vendor.id, name: it.name },
        select: { id: true },
      });
      console.log(`  ${existing ? "update" : "create"} item  ${it.name}  ₹${it.rupees}  [${it.tags.join(", ")}]`);
      if (!create) continue;
      if (existing) {
        await prisma.menuItem.update({
          where: { id: existing.id, vendorId: vendor.id },
          data: { priceInPaise, tags: [...it.tags], isAvailable: true },
        });
      } else {
        await prisma.menuItem.create({
          data: {
            vendorId: vendor.id,
            name: it.name,
            priceInPaise,
            tags: [...it.tags],
            category: it.category,
            emoji: "🥧",
          },
        });
      }
    }

    for (const p of PLANS) {
      const data = {
        name: p.name,
        description: p.description,
        eligibility: "TAG" as const,
        eligibleTag: "quiche",
        eligibleItemIds: [],
        minQty: p.minQty,
        requiredTag: "paneer",
        requiredTagQty: p.requiredTagQty,
        discountType: "PERCENT" as const,
        percentBps: p.percentBps,
        onMenuOrders: true,
        onDrops: true,
        onPos: true,
        dropIds: [],
        isActive: true,
        startsAt: null,
        endsAt: null,
      };
      const existing = await prisma.offer.findFirst({
        where: { vendorId: vendor.id, name: p.name },
        select: { id: true },
      });
      console.log(
        `  ${existing ? "update" : "create"} offer ${p.name}: ${p.minQty}+ quiche incl. ${p.requiredTagQty} paneer → ${p.percentBps / 100}% off`,
      );
      if (!create) continue;
      if (existing) {
        await prisma.offer.update({ where: { id: existing.id, vendorId: vendor.id }, data });
      } else {
        await prisma.offer.create({ data: { ...data, vendorId: vendor.id } });
      }
    }

    console.log(create ? "Done." : "Nothing written. Re-run with --create to apply.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
