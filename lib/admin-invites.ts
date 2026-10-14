/**
 * Platform admins for founder outreach (/admin/admins, /admin-invite/[token]).
 *
 * Roles: SUPER_ADMIN (platform owners) invites people as ADMIN. An ADMIN can run
 * the demo-store pipeline (/admin/demo-stores: build, claim links, delete
 * unclaimed) and read /admin/metrics — nothing else. Rules:
 *
 * - An invite is a one-time link for one email, valid ADMIN_INVITE_TTL_DAYS.
 *   Only a SHA-256 of the 192-bit token is stored; a new invite for the same
 *   email voids the earlier unused ones. Nothing is sent: the inviter passes
 *   the link on themselves.
 * - Redeeming it either creates the account with the invitee's own password
 *   (no account for that email yet) or promotes the signed-in account whose
 *   email matches. Never anyone else's account, and never a demotion: a
 *   SUPER_ADMIN who redeems one stays SUPER_ADMIN.
 * - Removing an admin sets them back to USER. A SUPER_ADMIN can't be removed
 *   here, and nobody removes themselves.
 * - Unknown, used and expired links are one answer.
 */
import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/storefront-razorpay";

export const ADMIN_INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AdminInviteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function hashAdminInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function adminInviteUrl(token: string): string {
  return `${appBaseUrl()}/admin-invite/${token}`;
}

/** Tokens from the URL: anything outside this length is not one of ours. */
export function plausibleInviteToken(token: string): boolean {
  return token.length >= 16 && token.length <= 256;
}

// ─── Invite ─────────────────────────────────────────────────────────

export async function createAdminInvite(email: string, invitedById: string, now: Date = new Date()) {
  const normalised = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalised }, select: { role: true } });
  if (existing && existing.role !== "USER") throw new AdminInviteError(409, "already_admin");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + ADMIN_INVITE_TTL_DAYS * DAY_MS);
  const [, invite] = await prisma.$transaction([
    prisma.adminInvite.deleteMany({ where: { email: normalised, usedAt: null } }),
    prisma.adminInvite.create({
      data: { email: normalised, tokenHash: hashAdminInviteToken(token), invitedById, expiresAt },
      select: { id: true },
    }),
  ]);
  return { id: invite.id, invite_url: adminInviteUrl(token), expires_at: expiresAt.toISOString() };
}

/** Pending (unused, unexpired) invites, newest first. */
export function listPendingAdminInvites(now: Date = new Date()) {
  return prisma.adminInvite.findMany({
    where: { usedAt: null, expiresAt: { gt: now } },
    select: { id: true, email: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function revokeAdminInvite(id: string): Promise<void> {
  const res = await prisma.adminInvite.deleteMany({ where: { id, usedAt: null } });
  if (res.count !== 1) throw new AdminInviteError(404, "not_found");
}

// ─── Redeem ─────────────────────────────────────────────────────────

/** What the invite page shows. null = no usable invite. */
export async function loadAdminInvite(token: string, now: Date = new Date()) {
  const invite = await prisma.adminInvite.findUnique({
    where: { tokenHash: hashAdminInviteToken(token) },
    select: { email: true, usedAt: true, expiresAt: true },
  });
  if (!invite || invite.usedAt || invite.expiresAt <= now) return null;
  const account = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  return { email: invite.email, hasAccount: account !== null };
}

/** Burns the token inside `tx`; throws the one "invalid or expired" answer if it can't. */
async function burnInvite(tx: Prisma.TransactionClient, token: string, now: Date): Promise<string> {
  const invite = await tx.adminInvite.findUnique({
    where: { tokenHash: hashAdminInviteToken(token) },
    select: { id: true, email: true },
  });
  if (!invite) throw new AdminInviteError(400, "invalid_or_expired");
  const burned = await tx.adminInvite.updateMany({
    where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (burned.count !== 1) throw new AdminInviteError(400, "invalid_or_expired");
  return invite.email;
}

/** No account for the invited email yet: create it as ADMIN with the invitee's own password. */
export async function redeemAdminInviteAsNewUser(
  input: { token: string; name: string; password: string },
  now: Date = new Date(),
): Promise<{ email: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const email = await burnInvite(tx, input.token, now);
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new AdminInviteError(409, "email_in_use");
      }
      await tx.user.create({ data: { email, name: input.name.trim(), passwordHash, role: "ADMIN" } });
      return { email };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AdminInviteError(409, "email_in_use");
    }
    throw err;
  }
}

/** The signed-in account takes the invite — only if it was sent to this account's email. */
export async function redeemAdminInviteAsUser(token: string, userId: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
    const invite = await tx.adminInvite.findUnique({
      where: { tokenHash: hashAdminInviteToken(token) },
      select: { email: true },
    });
    // A link for someone else answers like a dead link.
    if (!user || !invite || invite.email !== user.email.toLowerCase()) {
      throw new AdminInviteError(400, "invalid_or_expired");
    }
    await burnInvite(tx, token, now);
    if (user.role === "USER") {
      await tx.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    }
  });
}

// ─── Admins ─────────────────────────────────────────────────────────

export function listPlatformAdmins() {
  return prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
  });
}

/** ADMIN → USER. A SUPER_ADMIN, yourself or a non-admin is refused. */
export async function removePlatformAdmin(userId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) throw new AdminInviteError(409, "cannot_remove_self");
  const res = await prisma.user.updateMany({ where: { id: userId, role: "ADMIN" }, data: { role: "USER" } });
  if (res.count !== 1) throw new AdminInviteError(404, "not_found");
}
