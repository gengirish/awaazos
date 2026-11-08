"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DemoStoreActions } from "@/components/admin/DemoStoreActions";
import { HygieneChips } from "@/components/admin/pipeline/HygieneChips";
import { templateFor, type MessageContext, type PipelineHandlers } from "@/components/admin/pipeline/PipelineClient";
import { bulkArchive, postPipelineAction } from "@/components/admin/pipeline/pipeline-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RadioOption } from "@/components/ui/radio-option";
import { formatIstDate } from "@/lib/datetime";
import type { PipelineItem } from "@/lib/demo-pipeline-server";
import { PIPELINE_STATUS_LABEL, pipelineState, templateKindFor } from "@/lib/demo-pipeline";
import { useRouter } from "next/navigation";

function statusDetail(item: PipelineItem, now: Date): string | null {
  const { status, nextActionAt } = pipelineState(item.facts, now);
  if (status === "claimed") return item.facts.claimedAt ? `Claimed ${formatIstDate(item.facts.claimedAt)}.` : null;
  if (status === "archived") {
    return item.facts.archivedReason === "stale" || !item.facts.archivedAt
      ? "Archived as stale: never sent, no orders."
      : `Archived ${formatIstDate(item.facts.archivedAt)}.`;
  }
  if (status === "built") return "Not sent yet.";
  const parts: string[] = [];
  if (item.facts.inviteSentAt) parts.push(`Sent ${formatIstDate(item.facts.inviteSentAt)}.`);
  if (item.link) {
    parts.push(
      item.link.expired
        ? `Claim link expired ${formatIstDate(item.link.expiresAt)}.`
        : `Claim link works until ${formatIstDate(item.link.expiresAt)}.`,
    );
  }
  if (nextActionAt) parts.push(`Next follow-up ${formatIstDate(nextActionAt)}.`);
  return parts.join(" ");
}

type Props = {
  items: PipelineItem[];
  now: Date;
  canDelete: boolean;
  sender: MessageContext;
  handlers: PipelineHandlers;
  healthLines: Record<string, ReactNode>;
  isSales: boolean;
  onBulkSend: (items: PipelineItem[]) => void;
};

/** Every store as a card (the page's fallback view), with bulk selection and the archive. */
export function StoreList({ items, now, canDelete, sender, handlers, healthLines, isSales, onBulkSend }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [archiving, setArchiving] = useState(false);

  const isArchived = (item: PipelineItem) => pipelineState(item.facts, now).status === "archived";
  const shown = items.filter((item) => (filter === "archived" ? isArchived(item) : !isArchived(item)));
  const selectable = shown.filter((i) => i.facts.isDemo && i.ref && !isArchived(i));
  const unsent = selectable.filter((i) => pipelineState(i.facts, now).status === "built");
  const chosen = selectable.filter((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const copy = new Set(current);
      if (on) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  async function archiveChosen() {
    setArchiving(true);
    try {
      const { succeeded, failed } = await bulkArchive(chosen.flatMap((i) => (i.ref ? [i.ref] : [])));
      toast(
        `Archived ${succeeded.length} ${succeeded.length === 1 ? "store" : "stores"}${
          failed.length ? `, ${failed.length} could not be archived` : ""
        }`,
        {
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              void Promise.allSettled(
                succeeded.map((s) => postPipelineAction(s.ref, { action: "undo", event_id: s.event_id })),
              ).then((results) => {
                if (results.some((r) => r.status === "rejected")) toast.error("Some stores could not be restored.");
                router.refresh();
              });
            },
          },
        },
      );
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Could not archive. Try again.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div>
      <fieldset className="mb-4">
        <legend className="sr-only">Show stores</legend>
        <div className="flex flex-wrap gap-2">
          <RadioOption
            size="compact"
            name="pipeline-filter"
            className="min-w-24"
            label="Active"
            checked={filter === "active"}
            onChange={() => setFilter("active")}
          />
          <RadioOption
            size="compact"
            name="pipeline-filter"
            className="min-w-24"
            label="Archived"
            checked={filter === "archived"}
            onChange={() => setFilter("archived")}
          />
        </div>
      </fieldset>

      {filter === "active" && unsent.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-4"
          onClick={() => setSelected(new Set(unsent.map((i) => i.id)))}
        >
          Select all Built, not sent ({unsent.length})
        </Button>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          title={filter === "archived" ? "Nothing archived" : "No demo stores yet"}
          description={
            filter === "archived"
              ? "Stores you archive, and unsent ones past 21 days with no orders, appear here."
              : isSales
                ? "Stores you build appear here."
                : "Stores built here or with the internal demo-store API appear here."
          }
        />
      ) : (
        <ul className="space-y-4">
          {shown.map((item) => {
            const { status } = pipelineState(item.facts, now);
            const detail = statusDetail(item, now);
            const archived = status === "archived";
            return (
              <li key={item.id} className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    {item.facts.isDemo && item.ref && !archived ? (
                      <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                        <span className="sr-only">Select {item.name}</span>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selected.has(item.id)}
                          onChange={(e) => toggle(item.id, e.target.checked)}
                        />
                      </label>
                    ) : null}
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-foreground">{item.name}</h3>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        <a href={item.storeUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          /s/{item.slug}
                        </a>{" "}
                        · ref {item.ref}
                      </p>
                    </div>
                  </div>
                  <Badge variant={status === "claimed" ? "default" : "outline"}>{PIPELINE_STATUS_LABEL[status]}</Badge>
                </div>
                {detail ? <p className="mt-2 text-sm text-foreground">{detail}</p> : null}
                <p className="text-xs text-muted-foreground">Built {formatIstDate(item.facts.createdAt)}</p>
                {healthLines[item.id]}
                {archived ? (
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => handlers.restore(item)}>
                    Restore
                  </Button>
                ) : (
                  <HygieneChips item={item} handlers={handlers} stores={items} />
                )}
                {item.facts.isDemo && item.ref && !archived ? (
                  <DemoStoreActions
                    externalRef={item.ref}
                    storeName={item.name}
                    phone={item.phone}
                    message={templateFor(templateKindFor(item.facts, now), { ...item, contactEmail: null }, sender)}
                    contactEmail={item.contactEmail}
                    canDelete={canDelete}
                    onSent={(opened) => handlers.markSent(item, opened)}
                    onArchive={() => handlers.archive(item)}
                    onDelete={() => handlers.remove(item)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {chosen.length > 0 ? (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 rounded-t-lg border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
          <Button type="button" onClick={() => onBulkSend(chosen)}>
            Send invites ({chosen.length})
          </Button>
          <Button type="button" variant="outline" disabled={archiving} onClick={() => void archiveChosen()}>
            Archive ({chosen.length})
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
