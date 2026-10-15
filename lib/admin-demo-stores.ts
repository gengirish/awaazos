/**
 * Founder-outreach pipeline for the platform admin page `/admin/demo-stores`:
 * every demo store (lib/demo-store.ts, built from /admin/demo-stores/new or the
 * internal API) and how far the prospect got. Read-only.
 *
 * Cross-tenant, like lib/admin-vendors.ts: callers must have passed
 * `requirePlatformRole("ADMIN")` first — outreach admins work this page. The
 * handover's prospect email is never selected — the stage needs only its dates.
 * The only contact detail read is the seller's public business number.
 *
 * A store belongs here while `demoExternalRef` is set, which outlives the claim
 * (`isDemo` flips to false then). The stage is derived on every read.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const DEMO_PIPELINE_LIMIT = 100;

const DEMO_PIPELINE_SELECT = {
  id: true,
  slug: true,
  name: true,
  isDemo: true,
  demoExternalRef: true,
  createdAt: true,
  // The prospect's public business number (from the create payload), for the
  // admin's wa.me message. Opt-ins are off, so it isn't on their storefront.
  settings: { select: { whatsappNumber: true } },
  demoHandovers: {
    select: { createdAt: true, expiresAt: true, usedAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  },
} satisfies Prisma.VendorSelect;

export type DemoPipelineRow = Prisma.VendorGetPayload<{ select: typeof DEMO_PIPELINE_SELECT }>;

/** Newest demo stores first, claimed ones included. */
export function listDemoPipeline(): Promise<DemoPipelineRow[]> {
  return prisma.vendor.findMany({
    where: { demoExternalRef: { not: null } },
    select: DEMO_PIPELINE_SELECT,
    orderBy: { createdAt: "desc" },
    take: DEMO_PIPELINE_LIMIT,
  });
}

type Handover = DemoPipelineRow["demoHandovers"][number];

export type DemoStage =
  | { kind: "built" }
  | { kind: "invited"; sentAt: Date; expiresAt: Date }
  | { kind: "invite_expired"; sentAt: Date; expiredAt: Date }
  /** `claimedAt` is null only if the used handover row is gone. */
  | { kind: "claimed"; claimedAt: Date | null };

export const DEMO_STAGE_ORDER = ["built", "invited", "invite_expired", "claimed"] as const satisfies readonly DemoStage["kind"][];

export const DEMO_STAGE_LABEL: Record<DemoStage["kind"], string> = {
  built: "Built, not sent",
  invited: "Invite sent",
  invite_expired: "Invite expired",
  claimed: "Claimed",
};

/**
 * Where a demo store stands. Claimed wins (the store is no longer a demo);
 * then an invite that can still be used; then the newest expired invite.
 * `handovers` may come in any order.
 */
export function demoStage(
  row: { isDemo: boolean; demoHandovers: readonly Handover[] },
  now: Date = new Date(),
): DemoStage {
  if (!row.isDemo) {
    const used = row.demoHandovers.filter((h) => h.usedAt).sort((a, b) => b.usedAt!.getTime() - a.usedAt!.getTime())[0];
    return { kind: "claimed", claimedAt: used?.usedAt ?? null };
  }
  const newestFirst = [...row.demoHandovers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const live = newestFirst.find((h) => !h.usedAt && h.expiresAt.getTime() > now.getTime());
  if (live) return { kind: "invited", sentAt: live.createdAt, expiresAt: live.expiresAt };
  const last = newestFirst[0];
  if (last) return { kind: "invite_expired", sentAt: last.createdAt, expiredAt: last.expiresAt };
  return { kind: "built" };
}

export function countDemoStages(stages: readonly DemoStage[]): Record<DemoStage["kind"], number> {
  const counts: Record<DemoStage["kind"], number> = { built: 0, invited: 0, invite_expired: 0, claimed: 0 };
  for (const s of stages) counts[s.kind] += 1;
  return counts;
}
