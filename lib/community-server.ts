/**
 * Queries behind community pages (rules in lib/community.ts).
 *
 * Three kinds of caller, three scopes:
 *   - the public page `/c/[slug]`: `loadCommunityPage`, allowlisted select;
 *   - platform admins (/admin/communities, /api/admin/communities/**):
 *     deliberately cross-tenant, so every caller must have passed
 *     `requirePlatformRole("ADMIN")` first;
 *   - a store's OWNER (Settings → Online store, /api/vendor/communities/[id]):
 *     every query is scoped to that vendor's id.
 */
import { Prisma } from "@prisma/client";

import {
  COMMUNITY_STORE_LIMIT,
  communityStoreOrdering,
  sortCommunityStores,
  storeSlugFromInput,
  type CommunityCreateInput,
  type CommunityStoreOrdering,
  type CommunityUpdateInput,
  type VendorCommunity,
} from "@/lib/community";
import { prisma } from "@/lib/prisma";

export class CommunityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const notFound = () => new CommunityError("not_found", 404);

/** The vendor rows a public page may list: same gate as `/s/[slug]`, demo stores never. */
const LISTABLE_VENDOR_WHERE = {
  isActive: true,
  isDemo: false,
  settings: { is: { publishStorefront: true } },
} satisfies Prisma.VendorWhereInput;

// ─── Public page ───────────────────────────────────────────────────

export type CommunityPageStore = {
  slug: string;
  name: string;
  stallType: Prisma.VendorGetPayload<{ select: { stallType: true } }>["stallType"];
  stallTypeOther: string | null;
  city: string | null;
  logoUrl: string | null;
  ordering: CommunityStoreOrdering;
};

export type CommunityPage = {
  slug: string;
  name: string;
  area: string | null;
  description: string | null;
  stores: CommunityPageStore[];
};

/** Null for an unknown slug. A page whose stores are all hidden still loads, with none. */
export async function loadCommunityPage(slug: string, now: Date = new Date()): Promise<CommunityPage | null> {
  const community = await prisma.community.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      area: true,
      description: true,
      members: {
        where: { acceptedAt: { not: null }, vendor: LISTABLE_VENDOR_WHERE },
        orderBy: { acceptedAt: "asc" },
        take: COMMUNITY_STORE_LIMIT,
        select: {
          vendor: {
            select: {
              slug: true,
              name: true,
              stallType: true,
              stallTypeOther: true,
              city: true,
              logoUrl: true,
              settings: { select: { acceptMenuOrders: true } },
              drops: {
                where: { status: "OPEN", closesAt: { gt: now } },
                orderBy: { closesAt: "asc" },
                take: 5,
                select: { title: true, status: true, opensAt: true, closesAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!community) return null;

  const stores = community.members.map(({ vendor }) => ({
    slug: vendor.slug,
    name: vendor.name,
    stallType: vendor.stallType,
    stallTypeOther: vendor.stallTypeOther,
    city: vendor.city,
    logoUrl: vendor.logoUrl,
    ordering: communityStoreOrdering(
      { slug: vendor.slug, name: vendor.name, acceptMenuOrders: vendor.settings?.acceptMenuOrders ?? false, drops: vendor.drops },
      now,
    ),
  }));

  return {
    slug: community.slug,
    name: community.name,
    area: community.area,
    description: community.description,
    stores: sortCommunityStores(stores),
  };
}

// ─── Platform admin ────────────────────────────────────────────────

const ADMIN_MEMBER_SELECT = {
  acceptedAt: true,
  createdAt: true,
  vendor: {
    select: {
      id: true,
      slug: true,
      name: true,
      isActive: true,
      settings: { select: { publishStorefront: true } },
    },
  },
} satisfies Prisma.CommunityMemberSelect;

const ADMIN_COMMUNITY_SELECT = {
  id: true,
  slug: true,
  name: true,
  area: true,
  description: true,
  createdAt: true,
  members: { orderBy: { createdAt: "asc" }, select: ADMIN_MEMBER_SELECT },
} satisfies Prisma.CommunitySelect;

export type AdminCommunity = Prisma.CommunityGetPayload<{ select: typeof ADMIN_COMMUNITY_SELECT }>;

export function listAdminCommunities(): Promise<AdminCommunity[]> {
  return prisma.community.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: ADMIN_COMMUNITY_SELECT });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createCommunity(input: CommunityCreateInput, createdById: string) {
  try {
    return await prisma.community.create({
      data: {
        slug: input.slug,
        name: input.name,
        area: input.area ?? null,
        description: input.description ?? null,
        createdById,
      },
      select: { id: true, slug: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CommunityError("community_slug_taken", 409);
    throw err;
  }
}

export async function updateCommunity(id: string, input: CommunityUpdateInput) {
  try {
    return await prisma.community.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      select: { id: true, slug: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CommunityError("community_slug_taken", 409);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw notFound();
    throw err;
  }
}

export async function deleteCommunity(id: string): Promise<void> {
  const { count } = await prisma.community.deleteMany({ where: { id } });
  if (count === 0) throw notFound();
}

/**
 * Invite a store by its link. Lists nothing until the store's OWNER accepts.
 * Any store can be invited, published or not: it shows on the page only once
 * it is published (rule 3 in lib/community.ts).
 */
export async function inviteStore(communityId: string, storeInput: string) {
  const slug = storeSlugFromInput(storeInput);
  const [community, vendor] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: { id: true } }),
    prisma.vendor.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, isDemo: true } }),
  ]);
  if (!community) throw notFound();
  if (!vendor) throw new CommunityError("store_not_found", 404);
  if (vendor.isDemo) throw new CommunityError("demo_store", 409);
  try {
    await prisma.communityMember.create({ data: { communityId, vendorId: vendor.id } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CommunityError("already_invited", 409);
    throw err;
  }
  return { vendorId: vendor.id, name: vendor.name, slug: vendor.slug };
}

export async function removeStore(communityId: string, vendorId: string): Promise<void> {
  const { count } = await prisma.communityMember.deleteMany({ where: { communityId, vendorId } });
  if (count === 0) throw notFound();
}

// ─── Store owner ───────────────────────────────────────────────────

/** The community pages that invited or list this store, oldest first. */
export async function listVendorCommunities(vendorId: string): Promise<VendorCommunity[]> {
  const rows = await prisma.communityMember.findMany({
    where: { vendorId },
    orderBy: { createdAt: "asc" },
    select: { acceptedAt: true, community: { select: { id: true, slug: true, name: true, area: true } } },
  });
  return rows.map((r) => ({ ...r.community, accepted: r.acceptedAt !== null }));
}

/** Accept an invite. Idempotent: accepting twice keeps the first date. */
export async function acceptCommunityInvite(vendorId: string, communityId: string, now: Date = new Date()) {
  const { count } = await prisma.communityMember.updateMany({
    where: { communityId, vendorId, acceptedAt: null },
    data: { acceptedAt: now },
  });
  if (count > 0) return;
  const exists = await prisma.communityMember.findUnique({
    where: { communityId_vendorId: { communityId, vendorId } },
    select: { id: true },
  });
  if (!exists) throw notFound();
}

/** Decline an invite or leave a page — both just delete this store's row. */
export async function leaveCommunity(vendorId: string, communityId: string): Promise<void> {
  const { count } = await prisma.communityMember.deleteMany({ where: { communityId, vendorId } });
  if (count === 0) throw notFound();
}
