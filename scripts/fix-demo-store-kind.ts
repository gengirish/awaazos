/**
 * Re-file a demo store under a product category and re-pick the emoji its items
 * got as a kitchen (lib/demo-store-kind-fix.ts).
 *
 *   npm run demo:fix-store-kind -- <store-slug> --category=jewellery_accessories                 # dry run
 *   npm run demo:fix-store-kind -- <store-slug> --category=jewellery_accessories --apply --allow-remote
 *
 * Demo stores only: a real store stops it before any write. `--claimed` also lets it
 * fix a store a seller claimed from a demo (`demoExternalRef` still set) — that is a
 * live seller's store, so only with the owner's OK. A store that never was a demo is
 * always refused. Only items still on 🍽️
 * (or no emoji) with no photo get a new emoji; photos, prices and names are untouched.
 * Idempotent: a second run finds nothing to change.
 *
 * Reads DATABASE_URL from the environment, else from .env.local / .env.
 */
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { DEMO_CATEGORIES, type DemoCategory } from "@/lib/demo-store-schema";
import { planDemoKindFix } from "@/lib/demo-store-kind-fix";

function loadEnvFile(name: string): void {
  const file = path.join(process.cwd(), name);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function isDemoCategory(value: string | undefined): value is DemoCategory {
  return value !== undefined && Object.hasOwn(DEMO_CATEGORIES, value);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const category = args.find((a) => a.startsWith("--category="))?.slice("--category=".length);
  const apply = args.includes("--apply");
  const allowRemote = args.includes("--allow-remote");
  const claimed = args.includes("--claimed");
  if (!slug || !isDemoCategory(category)) {
    console.error(
      `Usage: npm run demo:fix-store-kind -- <store-slug> --category=${Object.keys(DEMO_CATEGORIES).join("|")} [--apply] [--allow-remote] [--claimed]`,
    );
    process.exit(1);
  }

  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!host) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const local = host === "localhost" || host === "127.0.0.1";
  if (apply && !local && !allowRemote) {
    console.error(`Refusing to write to a non-local database (${host}). Read the dry run, then pass --allow-remote.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { slug },
      select: { id: true, name: true, isDemo: true, demoExternalRef: true, stallType: true, stallTypeOther: true },
    });
    if (!vendor) {
      console.error(`No store with the slug "${slug}".`);
      process.exit(1);
    }
    const wasDemo = vendor.demoExternalRef !== null;
    if (!vendor.isDemo && !(claimed && wasDemo)) {
      console.error(
        wasDemo
          ? `/s/${slug} was claimed by its seller. Pass --claimed to fix it anyway (with the owner's OK); nothing was written.`
          : `/s/${slug} is a real store that never was a demo. This script won't touch it; nothing was written.`,
      );
      process.exit(1);
    }
    if (!vendor.isDemo) console.log(`  note: /s/${slug} is a claimed store (live seller), fixing it because of --claimed`);
    const items = await prisma.menuItem.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, name: true, emoji: true, imageUrl: true },
      orderBy: { sortOrder: "asc" },
    });
    const plan = planDemoKindFix(vendor, category, items);

    console.log(`${apply ? "Applying" : "Dry run:"} ${vendor.name} (/s/${slug}) on ${host}`);
    console.log(
      `  store type: ${vendor.stallType}${vendor.stallTypeOther ? ` (${vendor.stallTypeOther})` : ""} → ${plan.stallType}${plan.stallTypeOther ? ` (${plan.stallTypeOther})` : ""}${plan.storeChanges ? "" : " (no change)"}`,
    );
    for (const i of plan.items) console.log(`  emoji: ${i.name}  ${i.from ?? "(none)"} → ${i.to}`);
    const kept = items.length - plan.items.length;
    console.log(`  ${plan.items.length} item(s) re-picked, ${kept} kept (photo or own emoji)`);

    if (!apply) {
      console.log("Nothing written. Add --apply to write it.");
      return;
    }
    if (!plan.storeChanges && plan.items.length === 0) {
      console.log("Nothing to change.");
      return;
    }
    await prisma.$transaction(async (tx) => {
      if (plan.storeChanges) {
        await tx.vendor.update({
          where: vendor.isDemo ? { id: vendor.id, isDemo: true } : { id: vendor.id, demoExternalRef: vendor.demoExternalRef ?? "" },
          data: { stallType: plan.stallType, stallTypeOther: plan.stallTypeOther },
        });
      }
      for (const i of plan.items) {
        await tx.menuItem.update({ where: { id: i.id, vendorId: vendor.id }, data: { emoji: i.to } });
      }
    });
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
