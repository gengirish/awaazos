/**
 * Build (or refresh) a clean demo store for outreach (lib/demo-fixture.ts).
 *
 *   npm run seed:demo-store -- --category=bakery --city=Hyderabad                 # dry run
 *   npm run seed:demo-store -- --category=bakery --city=Hyderabad --create        # writes it
 *   npm run seed:demo-store -- --category=wellness --city=Bengaluru --name="Tulsi & Thyme" --create
 *
 * Options: --category=bakery|meals|wellness|crafts (default bakery), --city (required),
 * --name (default: the category's sample name), --ref (the demo store's external ref,
 * default "fixture-<slug>"), --allow-remote (anything but a local database).
 *
 * The store is created through the same path as the internal demo-store API
 * (`createDemoStore`: a demo store owned by DEMO_OWNER_EMAIL, demo@upi, no trial),
 * then `applyDemoFixture` adds the tagline, pictures, one open drop, the plan and
 * the slots. Idempotent: run it again with the same ref and the drop's dates move
 * forward; nothing is duplicated. It only ever writes demo stores: a store link
 * that belongs to a real store (sampreeti-store, say) stops it before any write.
 *
 * Reads DATABASE_URL (and DEMO_OWNER_EMAIL, AUTH_SECRET) from the environment,
 * else from .env.local / .env.
 */
import fs from "node:fs";
import path from "node:path";

import { rupeesToPaise } from "@/lib/currency";
import {
  buildDemoFixture,
  DEMO_FIXTURE_CATEGORIES,
  fixtureMenuItems,
  isDemoFixtureCategory,
  type DemoFixtureCategory,
} from "@/lib/demo-fixture";

function loadEnvFile(name: string): void {
  const file = path.join(process.cwd(), name);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function arg(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** Outreach category of the demo-store API for each fixture category. */
const API_CATEGORY: Record<DemoFixtureCategory, "home_bakery" | "home_kitchen" | "general"> = {
  bakery: "home_bakery",
  meals: "home_kitchen",
  wellness: "general",
  crafts: "general",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const category = arg(args, "category") ?? "bakery";
  const city = arg(args, "city");
  const create = args.includes("--create");
  const allowRemote = args.includes("--allow-remote");
  if (!isDemoFixtureCategory(category) || !city) {
    console.error(
      `Usage: npm run seed:demo-store -- --city=<city> [--category=${DEMO_FIXTURE_CATEGORIES.join("|")}] [--name="Store name"] [--ref=<external-ref>] [--create] [--allow-remote]`,
    );
    process.exit(1);
  }
  const fixture = buildDemoFixture({ category, city, name: arg(args, "name") });
  const ref = arg(args, "ref") ?? `fixture-${fixture.slug}`.slice(0, 80);

  console.log(`${create ? "Writing" : "Dry run:"} ${fixture.name} (/s/${fixture.slug}), ${fixture.city}, ${category}`);
  console.log(`  tagline: ${fixture.tagline}`);
  for (const i of fixtureMenuItems(fixture)) {
    console.log(`  item: ${i.name} · ₹${i.rupees}${i.showOnline ? "" : " (drop only)"} · ${i.imageUrl}`);
  }
  console.log(
    `  drop: ${fixture.drop.title} · ${fixture.drop.items.map((i) => `${i.name}${i.maxQty !== null ? ` (${i.maxQty})` : ""}`).join(", ")}`,
  );
  console.log(`  offer: ${fixture.offer.name} · ${fixture.offer.description}`);
  console.log(`  ref: ${ref}`);
  if (!create) {
    console.log("Nothing written. Add --create to write it.");
    return;
  }

  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const url = process.env.DATABASE_URL ?? "";
  if (!allowRemote && !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    console.error("DATABASE_URL is not a local database. Read the dry run, then pass --allow-remote to write there.");
    process.exit(1);
  }

  // After the env is loaded: these read DATABASE_URL / AUTH_SECRET when imported.
  const { prisma } = await import("@/lib/prisma");
  const { createDemoStore } = await import("@/lib/demo-store");
  const { applyDemoFixture } = await import("@/lib/demo-fixture-server");
  try {
    // A real store on the fixture's link: stop before writing anything.
    const onLink = await prisma.vendor.findUnique({
      where: { slug: fixture.slug },
      select: { isDemo: true, demoExternalRef: true },
    });
    if (onLink && (!onLink.isDemo || onLink.demoExternalRef !== ref)) {
      if (!onLink.isDemo) {
        console.error(`/s/${fixture.slug} is a real store. Pick another --name; nothing was written.`);
        process.exit(1);
      }
      console.log(`/s/${fixture.slug} is another demo store; this one keeps its own link.`);
    }

    const built = await createDemoStore(
      {
        external_ref: ref,
        profile: {
          name: fixture.name,
          category: API_CATEGORY[category],
          area: fixture.city,
          languages: ["en"],
          fulfilment: fixture.fulfilment === "BOTH" ? "both" : fixture.fulfilment === "DELIVERY" ? "delivery" : "pickup",
          delivery_fee_paise: fixture.deliveryFeePaise,
        },
        // The fixture writes the full catalogue; the API only needs one row to start.
        items: [{ name: fixture.everyday[0].name, price_paise: rupeesToPaise(fixture.everyday[0].rupees) }],
        sample_orders: [],
      },
      "script:seed-demo-store",
    );
    const result = await applyDemoFixture(prisma, built.store_id, fixture);
    console.log(
      `Done: /s/${result.slug}${result.slugChanged ? " (link set from the name)" : ""} · ${result.itemsCreated} items added, ${result.itemsUpdated} updated, ${result.itemsSwitchedOff} switched off.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
