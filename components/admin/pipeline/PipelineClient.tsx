"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { deleteStore, postPipelineAction, PipelineApiError } from "@/components/admin/pipeline/pipeline-api";
import { BulkSendDialog } from "@/components/admin/pipeline/BulkSendDialog";
import { OrdersWaitingBanner } from "@/components/admin/pipeline/OrdersWaitingBanner";
import { StoreList } from "@/components/admin/pipeline/StoreList";
import { TodayQueue } from "@/components/admin/pipeline/TodayQueue";
import type { PipelineItem } from "@/lib/demo-pipeline-server";
import {
  fillTemplate,
  isOrdersWaiting,
  needsClaimLink,
  PIPELINE_TILE_LABEL,
  PIPELINE_TILE_ORDER,
  pipelineState,
  pipelineTile,
  SNOOZE_DAYS,
  sortQueue,
  type PipelineArchiveReason,
  type PipelineFacts,
} from "@/lib/demo-pipeline";
import { outreachTemplate, outreachWhatsappUrl } from "@/lib/outreach-message";

const UNDO_MS = 6000;

/** A change the page shows before the server has answered, and keeps until the next read agrees. */
type Override = {
  facts?: Partial<PipelineFacts>;
  contactName?: string | null;
  contactEmail?: string | null;
  deleted?: boolean;
};

export type PipelineHandlers = {
  /** Opens WhatsApp with `text` (making the claim link first if it asks for one). False if it couldn't. */
  open: (item: PipelineItem, text: string) => Promise<boolean>;
  markSent: (item: PipelineItem, opened: boolean, quiet?: boolean) => void;
  snooze: (item: PipelineItem) => void;
  archive: (item: PipelineItem, reason?: Exclude<PipelineArchiveReason, "stale">) => void;
  restore: (item: PipelineItem) => void;
  remove: (item: PipelineItem) => void;
  saveContact: (item: PipelineItem, contact: { contactName: string; contactEmail: string }) => Promise<boolean>;
  /** Runs the newest toast's Undo, while it is still on screen. */
  undoLast: () => void;
};

export type MessageContext = { senderName: string | null; senderIsFounder: boolean };

export function templateFor(
  kind: Parameters<typeof outreachTemplate>[0],
  item: PipelineItem,
  sender: MessageContext,
): string {
  const template = outreachTemplate(kind, { ...sender, withClaimLink: Boolean(item.contactEmail) && item.facts.isDemo });
  return fillTemplate(template, {
    firstName: item.contactName,
    storeName: item.name,
    storeUrl: item.storeUrl,
    area: item.area,
  });
}

type Props = {
  items: PipelineItem[];
  now: Date;
  canDelete: boolean;
  sender: MessageContext;
  /** The server-rendered health row for each store, by id. */
  healthLines: Record<string, ReactNode>;
  isSales: boolean;
};

/**
 * /admin/demo-stores after the page's read. Holds the optimistic changes; every
 * view recomputes status and queue order from them with lib/demo-pipeline.ts, so
 * the tiles and the queue always agree.
 */
export function PipelineClient({ items: serverItems, now, canDelete, sender, healthLines, isSales }: Props) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map());
  const [view, setView] = useState<"today" | "all">("today");
  const [ordersOnly, setOrdersOnly] = useState(false);
  const [done, setDone] = useState(0);
  const [bulkItems, setBulkItems] = useState<PipelineItem[] | null>(null);
  const undoRef = useRef<{ run: () => void; until: number } | null>(null);
  // A link made this visit is used again: each new one emails the seller and voids the last.
  const claimUrls = useRef(new Map<string, string>());

  const items = useMemo(
    () =>
      serverItems.flatMap((item) => {
        const o = overrides.get(item.id);
        if (!o) return [item];
        if (o.deleted) return [];
        return [
          {
            ...item,
            contactName: o.contactName !== undefined ? o.contactName : item.contactName,
            contactEmail: o.contactEmail !== undefined ? o.contactEmail : item.contactEmail,
            facts: { ...item.facts, ...o.facts },
          },
        ];
      }),
    [serverItems, overrides],
  );
  const queue = useMemo(() => sortQueue(items, now), [items, now]);
  const waiting = useMemo(() => queue.filter((i) => isOrdersWaiting(i.facts)), [queue]);

  const counts = useMemo(() => {
    const c = { built: 0, sent: 0, expired: 0, claimed: 0 };
    for (const item of items) {
      const tile = pipelineTile(pipelineState(item.facts, now).status);
      if (tile) c[tile] += 1;
    }
    return c;
  }, [items, now]);

  const setOverride = useCallback((id: string, next: Override | undefined) => {
    setOverrides((current) => {
      const copy = new Map(current);
      if (next) copy.set(id, next);
      else copy.delete(id);
      return copy;
    });
  }, []);

  /**
   * One action: show it, send it, roll back and say so if it fails, then offer
   * Undo for six seconds.
   */
  const act = useCallback(
    async (
      item: PipelineItem,
      patch: Override,
      request: () => Promise<{ event_id?: string }>,
      message: string,
      opts: { quiet?: boolean; queueItem?: boolean } = {},
    ) => {
      const before = overrides.get(item.id);
      setOverride(item.id, { ...before, ...patch, facts: { ...before?.facts, ...patch.facts } });
      if (opts.queueItem) setDone((n) => n + 1);
      let eventId: string | undefined;
      try {
        ({ event_id: eventId } = await request());
      } catch (err) {
        setOverride(item.id, before);
        if (opts.queueItem) setDone((n) => n - 1);
        toast.error(err instanceof PipelineApiError ? err.message : "That didn't work. Try again.");
        return;
      }
      if (opts.quiet || !eventId || !item.ref) return;
      const ref = item.ref;
      const undo = () => {
        undoRef.current = null;
        setOverride(item.id, before);
        if (opts.queueItem) setDone((n) => n - 1);
        postPipelineAction(ref, { action: "undo", event_id: eventId })
          .then(() => router.refresh())
          .catch((err: unknown) => {
            setOverride(item.id, { ...before, ...patch, facts: { ...before?.facts, ...patch.facts } });
            toast.error(err instanceof PipelineApiError ? err.message : "Could not undo.");
          });
      };
      undoRef.current = { run: undo, until: Date.now() + UNDO_MS };
      toast(message, { duration: UNDO_MS, action: { label: "Undo", onClick: undo } });
    },
    [overrides, router, setOverride],
  );

  const handlers: PipelineHandlers = useMemo(
    () => ({
      open: async (item, text) => {
        const wantsLink = needsClaimLink(text);
        if (!wantsLink) {
          const href = outreachWhatsappUrl(text, item.phone);
          if (!href) {
            toast.error("The saved number doesn't look like a valid mobile number.");
            return false;
          }
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        if (!item.ref || !item.contactEmail) {
          toast.error("Save the seller's email first: the claim link goes to it.");
          return false;
        }
        // Opened during the tap, or the browser blocks it once we have waited on the network.
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        try {
          const claimUrl =
            claimUrls.current.get(item.id) ?? (await postPipelineAction(item.ref, { action: "claim_link" })).claim_url ?? "";
          claimUrls.current.set(item.id, claimUrl);
          const filled = text.replaceAll("{claimUrl}", claimUrl);
          const href = outreachWhatsappUrl(filled, item.phone);
          if (!href) throw new PipelineApiError("The saved number doesn't look like a valid mobile number.");
          if (tab) tab.location.href = href;
          else window.open(href, "_blank", "noopener,noreferrer");
          return true;
        } catch (err) {
          tab?.close();
          toast.error(err instanceof PipelineApiError ? err.message : "Could not make the claim link.");
          return false;
        }
      },
      markSent: (item, opened, quiet) => {
        if (!item.ref) return;
        const ref = item.ref;
        const at = new Date();
        const patch: Partial<PipelineFacts> = item.facts.inviteSentAt || !item.facts.isDemo
          ? { lastNudgeAt: at, nudgeCount: item.facts.nudgeCount + 1, snoozedUntil: null }
          : { inviteSentAt: at, snoozedUntil: null };
        void act(
          item,
          { facts: patch },
          () => postPipelineAction(ref, { action: "sent", opened }),
          `Marked ${item.name} as sent`,
          { quiet, queueItem: true },
        );
      },
      snooze: (item) => {
        if (!item.ref) return;
        const ref = item.ref;
        const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
        void act(
          item,
          { facts: { snoozedUntil: until } },
          () => postPipelineAction(ref, { action: "snooze", days: SNOOZE_DAYS }),
          `Snoozed ${item.name} for ${SNOOZE_DAYS} days`,
          { queueItem: true },
        );
      },
      archive: (item, reason = "manual") => {
        if (!item.ref) return;
        const ref = item.ref;
        void act(
          item,
          { facts: { archivedAt: new Date(), archivedReason: reason } },
          () => postPipelineAction(ref, { action: "archive", reason }),
          `Archived ${item.name}`,
          { queueItem: true },
        );
      },
      restore: (item) => {
        if (!item.ref) return;
        const ref = item.ref;
        void act(
          item,
          { facts: { archivedAt: null, archivedReason: null, restoredAt: new Date() } },
          () => postPipelineAction(ref, { action: "restore" }),
          `Restored ${item.name}`,
        );
      },
      remove: (item) => {
        if (!item.ref) return;
        const ref = item.ref;
        void act(item, { deleted: true }, () => deleteStore(ref), `Deleted ${item.name}`, { queueItem: true });
      },
      saveContact: async (item, contact) => {
        if (!item.ref) return false;
        try {
          await postPipelineAction(item.ref, {
            action: "contact",
            contact_name: contact.contactName.trim(),
            contact_email: contact.contactEmail.trim(),
          });
        } catch (err) {
          toast.error(err instanceof PipelineApiError ? err.message : "Could not save. Check the email.");
          return false;
        }
        const before = overrides.get(item.id);
        setOverride(item.id, {
          ...before,
          contactName: contact.contactName.trim() || null,
          contactEmail: contact.contactEmail.trim().toLowerCase() || null,
        });
        return true;
      },
      undoLast: () => {
        const last = undoRef.current;
        if (last && Date.now() < last.until) {
          toast.dismiss();
          last.run();
        }
      },
    }),
    [act, overrides, setOverride],
  );

  return (
    <>
      {waiting.length > 0 ? (
        <OrdersWaitingBanner
          count={waiting.length}
          active={ordersOnly}
          onToggle={() => {
            setOrdersOnly((on) => !on);
            setView("today");
          }}
        />
      ) : null}

      <section aria-labelledby="summary-heading" className="mb-6">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PIPELINE_TILE_ORDER.map((tile) => (
            <div key={tile} className="rounded-lg border bg-card p-3 shadow-xs">
              <dt className="text-xs text-muted-foreground">{PIPELINE_TILE_LABEL[tile]}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">{counts[tile]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div role="tablist" aria-label="Pipeline view" className="mb-4 inline-flex rounded-lg border bg-muted p-1">
        {(
          [
            ["today", "Today"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`pipeline-tab-${key}`}
            aria-selected={view === key}
            aria-controls="demo-stores"
            onClick={() => setView(key)}
            className={`min-h-11 min-w-20 rounded-md px-4 text-sm font-medium ${
              view === key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section id="demo-stores" role="tabpanel" aria-labelledby={`pipeline-tab-${view}`}>
        {view === "today" ? (
          <TodayQueue
            queue={ordersOnly ? waiting : queue}
            stores={items}
            ordersOnly={ordersOnly}
            now={now}
            done={done}
            canDelete={canDelete}
            sender={sender}
            handlers={handlers}
          />
        ) : (
          <StoreList
            items={items}
            now={now}
            canDelete={canDelete}
            sender={sender}
            handlers={handlers}
            healthLines={healthLines}
            isSales={isSales}
            onBulkSend={setBulkItems}
          />
        )}
      </section>

      {bulkItems ? (
        <BulkSendDialog
          items={bulkItems}
          sender={sender}
          handlers={handlers}
          onClose={() => setBulkItems(null)}
        />
      ) : null}
    </>
  );
}
