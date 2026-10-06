/**
 * Shared seeding for push.db.test.ts and push-routes.db.test.ts. Not a test
 * file itself (vitest only collects *.test.ts). Takes `prisma` as an argument
 * so the test files can keep importing Prisma lazily.
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

export const fakeEndpoint = () => `https://fcm.googleapis.com/fcm/send/test-${randomBytes(12).toString("hex")}`;

export const fakeKeys = () => ({
  p256dh: randomBytes(65).toString("base64url"), // 87 chars
  auth: randomBytes(16).toString("base64url"), // 22 chars
});

/** Turn push on with a freshly generated (real, valid) VAPID pair. */
export function setFakeVapidEnv(generate: () => { publicKey: string; privateKey: string }) {
  const k = generate();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = k.publicKey;
  process.env.VAPID_PRIVATE_KEY = k.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
}

export function clearVapidEnv() {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

/**
 * A vendor with two menu items and three staff: an active owner, an active
 * cashier and a former (inactive) cashier.
 */
export async function seedPushVendor(prisma: PrismaClient) {
  const tag = randomBytes(5).toString("hex");
  const mkUser = (who: string) => prisma.user.create({ data: { email: `push-${who}-${tag}@example.test`, name: who } });
  const [owner, cashier, former] = await Promise.all([mkUser("owner"), mkUser("cashier"), mkUser("former")]);
  const vendor = await prisma.vendor.create({
    data: {
      slug: `push-test-${tag}`,
      name: `Push Test ${tag}`,
      ownerName: "Test Owner",
      plan: "PRO",
      upiId: "kitchen@upi",
      settings: { create: { publishStorefront: true, acceptPayOnDelivery: true, acceptMenuOrders: true } },
      menuItems: {
        create: [
          { name: "Samosa", priceInPaise: 2000 },
          { name: "Chai", priceInPaise: 1500 },
        ],
      },
      staff: {
        create: [
          { userId: owner.id, name: "Owner", role: "OWNER" },
          { userId: cashier.id, name: "Cashier", role: "CASHIER" },
          { userId: former.id, name: "Former", role: "CASHIER", isActive: false },
        ],
      },
    },
    include: { menuItems: { orderBy: { name: "asc" } } },
  });
  return { vendor, owner, cashier, former, userIds: [owner.id, cashier.id, former.id] };
}

export function addSubscription(
  prisma: PrismaClient,
  vendorId: string,
  userId: string,
  extra: { failureCount?: number; label?: string } = {},
) {
  return prisma.pushSubscription.create({
    data: { vendorId, userId, endpoint: fakeEndpoint(), ...fakeKeys(), ...extra },
  });
}
