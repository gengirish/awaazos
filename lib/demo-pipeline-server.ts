/**
 * Database side of the outreach pipeline (rules: lib/demo-pipeline.ts). Callers
 * passed `requirePlatformRole("SALES")`, and a SALES caller's ownership check.
 *
 * Every action writes its DemoPipeline change and a DemoAuditLog row in one
 * transaction. The audit payload holds what the action replaced (dates and enums,
 * never the seller's name or email), which is what undo restores. Undo only works
 * on the store's newest pipeline row and only for the admin who made it.
 */
import { FulfilmentStatus, Prisma, type DemoArchiveReason } from "@prisma/client";
import { z } from "zod";

import { healthFor, loadStoreHealth, type StoreHealth } from "@/lib/admin-store-health";
import { demoStage, listDemoPipeline, type DemoPipelineRow } from "@/lib/admin-demo-stores";
import { createHandover, DemoStoreError, publicStoreUrl } from "@/lib/demo-store";
import { findDuplicates, looksLikeTestStore, SNOOZE_DAYS, type PipelineFacts } from "@/lib/demo-pipeline";
import { sendDemoClaimEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Read ───────────────────────────────────────────────────────────

/** One store on the page. Dates survive the server-to-client hand-off. */
export type PipelineItem = {
  id: string;
  ref: string | null;
  slug: string;
  name: string;
  area: string | null;
  storeUrl: string;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  health: StoreHealth;
  /** Names and refs of stores that look like the same seller. */
  duplicates: { ref: string; name: string; orderCount: number; claimed: boolean }[];
  looksLikeTest: boolean;
  /** The claim link's dates, for the "link works until" line. */
  link: { sentAt: Date; expiresAt: Date; expired: boolean } | null;
  facts: PipelineFacts;
};

function factsFor(
  row: DemoPipelineRow,
  claimedAt: Date | null,
  aggregates: { orderCount: number; lastOrderAt: Date | null; dropsThisWeek: number },
): PipelineFacts {
  const p = row.demoPipeline;
  const newestLink = [...row.demoHandovers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    claimedAt,
    inviteSentAt: p?.inviteSentAt ?? newestLink?.createdAt ?? null,
    lastNudgeAt: p?.lastNudgeAt ?? null,
    nudgeCount: p?.nudgeCount ?? 0,
    snoozedUntil: p?.snoozedUntil ?? null,
    archivedAt: p?.archivedAt ?? null,
    archivedReason: p?.archivedReason ?? null,
    restoredAt: p?.restoredAt ?? null,
    ...aggregates,
  };
}

/** The page's whole read: the stores, then aggregates keyed on their ids (never one per store). */
export async function loadPipelineItems(onlyVendorIds?: string[], now: Date = new Date()): Promise<PipelineItem[]> {
  const rows = await listDemoPipeline(onlyVendorIds);
  const ids = rows.map((r) => r.id);
  const [health, orders] = await Promise.all([
    loadStoreHealth(ids, now),
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: ids }, isSample: false, fulfilmentStatus: { not: FulfilmentStatus.CANCELLED } },
      _count: { _all: true },
    }),
  ]);
  const orderCount = new Map(orders.map((r) => [r.vendorId, r._count._all]));

  const live = rows.filter((r) => !r.demoPipeline?.archivedAt);
  const duplicates = findDuplicates(
    live.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.city,
      phone: r.settings?.whatsappNumber ?? null,
      instagram: r.settings?.instagramHandle ?? null,
    })),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  return rows.map((row) => {
    const storeHealth = healthFor(health, row.id);
    const stage = demoStage(row, now);
    const claimedAt = stage.kind === "claimed" ? stage.claimedAt : null;
    const link =
      stage.kind === "invited"
        ? { sentAt: stage.sentAt, expiresAt: stage.expiresAt, expired: false }
        : stage.kind === "invite_expired"
          ? { sentAt: stage.sentAt, expiresAt: stage.expiredAt, expired: true }
          : null;
    return {
      id: row.id,
      ref: row.demoExternalRef,
      slug: row.slug,
      name: row.name,
      area: row.city,
      storeUrl: publicStoreUrl(row.slug),
      phone: row.settings?.whatsappNumber ?? null,
      contactName: row.demoPipeline?.contactName ?? null,
      contactEmail: row.demoPipeline?.contactEmail ?? null,
      health: storeHealth,
      duplicates: (duplicates.get(row.id) ?? []).flatMap((id) => {
        const other = byId.get(id);
        if (!other?.demoExternalRef) return [];
        return [
          {
            ref: other.demoExternalRef,
            name: other.name,
            orderCount: orderCount.get(id) ?? 0,
            claimed: !other.isDemo,
          },
        ];
      }),
      looksLikeTest: row.isDemo && looksLikeTestStore(row.name),
      link,
      facts: factsFor(row, claimedAt, {
        orderCount: orderCount.get(row.id) ?? 0,
        lastOrderAt: storeHealth.lastOrderAt,
        dropsThisWeek: storeHealth.dropsThisWeek,
      }),
    };
  });
}

// ─── Actions ────────────────────────────────────────────────────────

const email = z.string().trim().toLowerCase().email().max(254);

export const pipelineActionSchema = z.discriminatedUnion("action", [
  /** The admin opened WhatsApp for this store, or says they already messaged them. */
  z.object({ action: z.literal("sent"), opened: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("snooze"), days: z.number().int().min(1).max(30).default(SNOOZE_DAYS) }).strict(),
  z.object({ action: z.literal("archive"), reason: z.enum(["manual", "duplicate", "test"]).default("manual") }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
  /** A new one-time link, emailed to the saved address, for the message about to be sent. */
  z.object({ action: z.literal("claim_link") }).strict(),
  z
    .object({
      action: z.literal("contact"),
      contact_name: z.string().trim().max(40).optional(),
      contact_email: email.or(z.literal("")).optional(),
    })
    .strict(),
  z.object({ action: z.literal("undo"), event_id: z.string().min(1).max(64) }).strict(),
]);
export type PipelineAction = z.infer<typeof pipelineActionSchema>;

/** Audit actions an undo can reverse. */
const UNDOABLE = ["invite_sent", "nudge_sent", "snoozed", "archived", "restored", "delete"] as const;

type Previous = {
  inviteSentAt: string | null;
  lastNudgeAt: string | null;
  nudgeCount: number;
  snoozedUntil: string | null;
  archivedAt: string | null;
  archivedReason: DemoArchiveReason | null;
  restoredAt: string | null;
  deletedAt: string | null;
};

const PIPELINE_SELECT = {
  inviteSentAt: true,
  lastNudgeAt: true,
  nudgeCount: true,
  snoozedUntil: true,
  archivedAt: true,
  archivedReason: true,
  restoredAt: true,
  deletedAt: true,
} satisfies Prisma.DemoPipelineSelect;

type PipelineRow = Prisma.DemoPipelineGetPayload<{ select: typeof PIPELINE_SELECT }>;

function snapshot(p: PipelineRow | null): Previous {
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  return {
    inviteSentAt: iso(p?.inviteSentAt),
    lastNudgeAt: iso(p?.lastNudgeAt),
    nudgeCount: p?.nudgeCount ?? 0,
    snoozedUntil: iso(p?.snoozedUntil),
    archivedAt: iso(p?.archivedAt),
    archivedReason: p?.archivedReason ?? null,
    restoredAt: iso(p?.restoredAt),
    deletedAt: iso(p?.deletedAt),
  };
}

async function loadStore(ref: string, includeDeleted = false) {
  const v = await prisma.vendor.findUnique({
    where: { demoExternalRef: ref },
    select: {
      id: true,
      isDemo: true,
      demoPipeline: { select: { ...PIPELINE_SELECT, contactEmail: true } },
      demoHandovers: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  if (!v || (v.demoPipeline?.deletedAt && !includeDeleted)) throw new DemoStoreError(404, "not_found");
  return v;
}

/** Writes the change and its audit row together; returns the row's id for undo. */
async function record(
  vendorId: string,
  externalRef: string,
  actor: string,
  action: string,
  previous: PipelineRow | null,
  data: Prisma.DemoPipelineUncheckedCreateInput,
  extra: Record<string, string | number | boolean> = {},
): Promise<string> {
  const [, audit] = await prisma.$transaction([
    prisma.demoPipeline.upsert({ where: { vendorId }, create: data, update: data }),
    prisma.demoAuditLog.create({
      data: {
        action,
        externalRef,
        vendorId,
        actor,
        payload: { previous: snapshot(previous), ...extra } as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
  ]);
  return audit.id;
}

export type PipelineActionResult = { event_id?: string; claim_url?: string; emailed?: boolean };

export async function applyPipelineAction(
  ref: string,
  body: PipelineAction,
  actor: string,
  now: Date = new Date(),
): Promise<PipelineActionResult> {
  const store = await loadStore(ref, body.action === "undo");
  const previous = store.demoPipeline;
  const base = { vendorId: store.id };

  switch (body.action) {
    case "sent": {
      // A claimed store is past inviting, so its sends are always nudges.
      const firstSend = store.isDemo && !previous?.inviteSentAt && !store.demoHandovers[0];
      const event_id = firstSend
        ? await record(store.id, ref, actor, "invite_sent", previous, { ...base, inviteSentAt: now, snoozedUntil: null }, {
            opened: body.opened,
          })
        : await record(
            store.id,
            ref,
            actor,
            "nudge_sent",
            previous,
            { ...base, lastNudgeAt: now, nudgeCount: (previous?.nudgeCount ?? 0) + 1, snoozedUntil: null },
            { opened: body.opened },
          );
      return { event_id };
    }
    case "snooze": {
      const snoozedUntil = new Date(now.getTime() + body.days * DAY_MS);
      return {
        event_id: await record(store.id, ref, actor, "snoozed", previous, { ...base, snoozedUntil }, { days: body.days }),
      };
    }
    case "archive": {
      if (!store.isDemo) throw new DemoStoreError(409, "not_a_demo_store");
      // "Merging" duplicates keeps one store and archives the other; orders stay
      // where they are, so the copy with real orders is the one to keep.
      if (body.reason === "duplicate") {
        const real = await prisma.transaction.count({ where: { vendorId: store.id, isSample: false } });
        if (real > 0) throw new DemoStoreError(409, "has_real_orders");
      }
      return {
        event_id: await record(
          store.id,
          ref,
          actor,
          "archived",
          previous,
          { ...base, archivedAt: now, archivedReason: body.reason },
          { reason: body.reason },
        ),
      };
    }
    case "restore":
      return {
        event_id: await record(store.id, ref, actor, "restored", previous, {
          ...base,
          archivedAt: null,
          archivedReason: null,
          restoredAt: now,
        }),
      };
    case "claim_link": {
      const to = previous?.contactEmail;
      if (!to) throw new DemoStoreError(409, "email_required");
      const { claim_url, expires_at, store_name } = await createHandover(ref, to, actor, now);
      const { delivered } = await sendDemoClaimEmail({
        to,
        storeName: store_name,
        claimUrl: claim_url,
        expiresAt: new Date(expires_at),
      });
      return { claim_url, emailed: delivered };
    }
    case "contact": {
      const contact = {
        ...(body.contact_name !== undefined ? { contactName: body.contact_name || null } : {}),
        ...(body.contact_email !== undefined ? { contactEmail: body.contact_email || null } : {}),
      };
      await prisma.$transaction([
        prisma.demoPipeline.upsert({
          where: { vendorId: store.id },
          create: { ...base, ...contact },
          update: contact,
        }),
        prisma.demoAuditLog.create({
          data: { action: "contact_saved", externalRef: ref, vendorId: store.id, actor },
        }),
      ]);
      return {};
    }
    case "undo":
      return undoPipelineAction(store.id, ref, body.event_id, actor);
  }
}

async function undoPipelineAction(
  vendorId: string,
  externalRef: string,
  eventId: string,
  actor: string,
): Promise<PipelineActionResult> {
  const newest = await prisma.demoAuditLog.findFirst({
    where: { vendorId, action: { in: [...UNDOABLE, "undo"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, action: true, actor: true, payload: true },
  });
  if (
    !newest ||
    newest.id !== eventId ||
    newest.actor !== actor ||
    newest.action === "undo" ||
    !newest.payload ||
    typeof newest.payload !== "object" ||
    !("previous" in newest.payload)
  ) {
    throw new DemoStoreError(409, "undo_stale");
  }
  const p = (newest.payload as { previous: Previous }).previous;
  const date = (s: string | null) => (s ? new Date(s) : null);
  const data = {
    inviteSentAt: date(p.inviteSentAt),
    lastNudgeAt: date(p.lastNudgeAt),
    nudgeCount: p.nudgeCount,
    snoozedUntil: date(p.snoozedUntil),
    archivedAt: date(p.archivedAt),
    archivedReason: p.archivedReason,
    restoredAt: date(p.restoredAt),
    deletedAt: date(p.deletedAt),
  };
  await prisma.$transaction(async (tx) => {
    await tx.demoPipeline.upsert({ where: { vendorId }, create: { vendorId, ...data }, update: data });
    if (newest.action === "delete") await tx.vendor.update({ where: { id: vendorId }, data: { isActive: true } });
    await tx.demoAuditLog.create({
      data: { action: "undo", externalRef, vendorId, actor, payload: { of: newest.action } },
    });
  });
  return {};
}

/** The email an admin typed for a claim link: the next link needn't ask again. */
export async function rememberContactEmail(ref: string, contactEmail: string): Promise<void> {
  const v = await prisma.vendor.findUnique({ where: { demoExternalRef: ref }, select: { id: true } });
  if (!v) return;
  await prisma.demoPipeline.upsert({
    where: { vendorId: v.id },
    create: { vendorId: v.id, contactEmail },
    update: { contactEmail },
  });
}

/**
 * The admin page's delete: the store leaves the pipeline and its public pages and
 * claim links stop working, with nothing removed, so it can be undone. The internal
 * API keeps its real delete (`deleteDemoStore`).
 */
export async function softDeleteDemoStore(ref: string, actor: string, now: Date = new Date()): Promise<string> {
  const store = await loadStore(ref);
  if (!store.isDemo) throw new DemoStoreError(409, "not_a_demo_store");
  return prisma.$transaction(async (tx) => {
    // Scoped to a store that is still a demo, so one claimed meanwhile is left alone.
    const res = await tx.vendor.updateMany({ where: { id: store.id, isDemo: true }, data: { isActive: false } });
    if (res.count !== 1) throw new DemoStoreError(409, "not_a_demo_store");
    await tx.demoPipeline.upsert({
      where: { vendorId: store.id },
      create: { vendorId: store.id, deletedAt: now },
      update: { deletedAt: now },
    });
    const audit = await tx.demoAuditLog.create({
      data: {
        action: "delete",
        externalRef: ref,
        vendorId: store.id,
        actor,
        payload: { previous: snapshot(store.demoPipeline) } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return audit.id;
  });
}
