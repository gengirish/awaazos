/**
 * Writes a demo fixture (lib/demo-fixture.ts) into an existing demo store.
 * Server-only; used by scripts/seed-demo-store.ts, and meant for the internal
 * demo-store API to call after `createDemoStore` once it takes a category.
 *
 * - Demo stores only: every write is scoped `{ id, isDemo: true }`, so a real
 *   store (a claimed demo, or anyone's own store) is never touched.
 * - Idempotent: items, the drop and the offer are matched by name / title and
 *   updated in place; running it again moves the drop's dates forward to "about
 *   two days from now" and changes nothing else. Items that aren't in the
 *   fixture are switched off (`isAvailable: false`), never deleted, so sample
 *   orders keep their lines. Other open drops on the store are closed, so the
 *   page shows one.
 * - The store link becomes the name's slug when that link is free and valid;
 *   otherwise the store keeps the one it has (the result says which).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { rupeesToPaise } from "@/lib/currency";
import { fixtureMenuItems, type DemoFixture } from "@/lib/demo-fixture";
import { istToUtc, ymdToDbDate } from "@/lib/drops-time";
import { loadMenuCreateContext, prepareMenuItemCreate } from "@/lib/menu-create";
import { storeHandleProblem } from "@/lib/store-handle";

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function istYmd(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The drop's dates, from today: handover `daysAhead` days out, cut-off the evening before. */
export function fixtureDropTimes(f: DemoFixture, now: Date) {
  const day = istYmd(new Date(now.getTime() + f.drop.daysAhead * DAY_MS));
  const dayBefore = istYmd(new Date(now.getTime() + (f.drop.daysAhead - 1) * DAY_MS));
  return {
    date: ymdToDbDate(day),
    closesAt: istToUtc(dayBefore, f.drop.cutoffTime),
    fulfilmentStartsAt: istToUtc(day, f.drop.windowStart),
    fulfilmentEndsAt: istToUtc(day, f.drop.windowEnd),
  };
}

export type ApplyDemoFixtureResult = {
  slug: string;
  slugChanged: boolean;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSwitchedOff: number;
  dropId: string;
  offerId: string;
};

export async function applyDemoFixture(
  db: PrismaClient,
  vendorId: string,
  f: DemoFixture,
  now: Date = new Date(),
): Promise<ApplyDemoFixtureResult> {
  return db.$transaction(
    async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: vendorId, isDemo: true },
        select: { id: true, slug: true },
      });
      if (!vendor) throw new Error("applyDemoFixture: not a demo store");

      // Store link from the name, when it is valid and nobody else has it.
      let slug = vendor.slug;
      if (vendor.slug !== f.slug && storeHandleProblem(f.slug) === null) {
        const taken = await tx.vendor.findUnique({ where: { slug: f.slug }, select: { id: true } });
        if (!taken) slug = f.slug;
      }

      await tx.vendor.update({
        where: { id: vendor.id, isDemo: true },
        data: {
          name: f.name,
          slug,
          city: f.city,
          stallType: f.stallType,
          stallTypeOther: f.stallTypeOther,
          upiName: f.name,
        },
      });
      const settings = {
        tagline: f.tagline,
        theme: f.theme,
        publishStorefront: true,
        acceptMenuOrders: true,
        acceptPayOnDelivery: true,
        menuFulfilmentMode: f.fulfilment,
        menuDeliveryFeePaise: f.deliveryFeePaise,
        menuPickupNote: f.pickupNote,
        menuSlots: f.slots as unknown as Prisma.InputJsonValue,
      };
      await tx.vendorSettings.upsert({
        where: { vendorId: vendor.id },
        create: { vendorId: vendor.id, ...settings },
        update: settings,
      });

      // ── Items: matched by name (case-insensitive) ──────────────────────
      const existing = await tx.menuItem.findMany({
        where: { vendorId: vendor.id },
        select: { id: true, name: true },
      });
      const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m.id]));
      const ctx = await loadMenuCreateContext(tx, vendor.id);
      const idByName = new Map<string, string>();
      let itemsCreated = 0;
      let itemsUpdated = 0;
      for (const item of fixtureMenuItems(f)) {
        const fields = {
          priceInPaise: rupeesToPaise(item.rupees),
          category: item.category,
          description: item.description,
          emoji: item.emoji,
          imageUrl: item.imageUrl,
          isAvailable: true,
          showOnline: item.showOnline,
        };
        const id = byName.get(item.name.toLowerCase());
        if (id) {
          await tx.menuItem.update({ where: { id, vendorId: vendor.id }, data: fields });
          idByName.set(item.name, id);
          itemsUpdated++;
        } else {
          const data = prepareMenuItemCreate(ctx, vendor.id, {
            name: item.name,
            priceInPaise: fields.priceInPaise,
            aliases: [],
            tags: [],
            emoji: item.emoji,
            category: item.category,
            hsnCode: null,
            isPopular: false,
            isAvailable: true,
            showOnline: item.showOnline,
            description: item.description,
          });
          const row = await tx.menuItem.create({ data: { ...data, imageUrl: item.imageUrl }, select: { id: true } });
          idByName.set(item.name, row.id);
          itemsCreated++;
        }
      }
      // Anything else on the store ("test" rows from an earlier build) goes quiet.
      const keep = [...idByName.values()];
      const off = await tx.menuItem.updateMany({
        where: { vendorId: vendor.id, id: { notIn: keep }, isAvailable: true },
        data: { isAvailable: false },
      });

      // ── The drop: matched by title ─────────────────────────────────────
      const times = fixtureDropTimes(f, now);
      const dropData = {
        note: f.drop.note,
        ...times,
        fulfilmentMode: f.fulfilment,
        deliveryFeePaise: f.deliveryFeePaise,
        pickupNote: f.pickupNote,
        opensAt: null,
        status: "OPEN" as const,
        // The everyday list stays on the page beside the drop.
        showEverydayMenu: true,
      };
      const foundDrop = await tx.drop.findFirst({
        where: { vendorId: vendor.id, title: f.drop.title },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const drop = foundDrop
        ? await tx.drop.update({ where: { id: foundDrop.id, vendorId: vendor.id }, data: dropData, select: { id: true } })
        : await tx.drop.create({ data: { vendorId: vendor.id, title: f.drop.title, ...dropData }, select: { id: true } });
      // One open drop on a demo: any other (an older fixture's title) is closed, never deleted.
      await tx.drop.updateMany({
        where: { vendorId: vendor.id, id: { not: drop.id }, status: "OPEN" },
        data: { status: "CLOSED" },
      });
      for (const [i, item] of f.drop.items.entries()) {
        const menuItemId = idByName.get(item.name)!;
        const row = { priceInPaise: rupeesToPaise(item.rupees), maxQty: item.maxQty, perOrderLimit: null, sortOrder: i };
        await tx.dropItem.upsert({
          where: { dropId_menuItemId: { dropId: drop.id, menuItemId } },
          create: { dropId: drop.id, menuItemId, ...row },
          update: row,
        });
      }

      // ── The plan: "2+ → free <gift>", matched by name ──────────────────
      const giftId = idByName.get(f.gift.name)!;
      const eligibleItemIds = f.everyday.map((i) => idByName.get(i.name)!);
      const offerData = {
        description: f.offer.description,
        eligibility: "ITEMS" as const,
        eligibleItemIds,
        eligibleTag: null,
        minQty: f.offer.minQty,
        requiredTag: null,
        requiredTagQty: 0,
        discountType: "FREE_ITEM" as const,
        percentBps: 0,
        freeItemId: giftId,
        freeItemQty: 1,
        // Free items are online only, and a drop's gift must be one of its own items: menu orders only.
        onMenuOrders: true,
        onDrops: false,
        onPos: false,
        dropIds: [],
        isActive: true,
        startsAt: null,
        endsAt: null,
      };
      const foundOffer = await tx.offer.findFirst({
        where: { vendorId: vendor.id, name: f.offer.name },
        select: { id: true },
      });
      const offer = foundOffer
        ? await tx.offer.update({ where: { id: foundOffer.id, vendorId: vendor.id }, data: offerData, select: { id: true } })
        : await tx.offer.create({ data: { vendorId: vendor.id, name: f.offer.name, ...offerData }, select: { id: true } });

      return {
        slug,
        slugChanged: slug !== vendor.slug,
        itemsCreated,
        itemsUpdated,
        itemsSwitchedOff: off.count,
        dropId: drop.id,
        offerId: offer.id,
      };
    },
    { timeout: 30_000 },
  );
}
