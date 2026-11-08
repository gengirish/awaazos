"use client";

import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { HygieneChips } from "@/components/admin/pipeline/HygieneChips";
import {
  templateFor,
  type MessageContext,
  type PipelineHandlers,
} from "@/components/admin/pipeline/PipelineClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import type { PipelineItem } from "@/lib/demo-pipeline-server";
import {
  needsClaimLink,
  queueReason,
  SNOOZE_DAYS,
  templateKindFor,
} from "@/lib/demo-pipeline";
import { formatIndianMobile } from "@/lib/phone";

const FIELD =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Shortcuts stay out of the way of typing and of anything open on top of the card. */
function shortcutsAllowed(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return false;
  const target = e.target as HTMLElement | null;
  if (
    target?.closest(
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']",
    )
  )
    return false;
  return !document.querySelector("[role='dialog'], [role='menu']");
}

type Props = {
  queue: PipelineItem[];
  /** Every store on the page: a duplicate's other half may not be in the queue. */
  stores: PipelineItem[];
  ordersOnly: boolean;
  now: Date;
  /** Actions taken since the page loaded. */
  done: number;
  canDelete: boolean;
  sender: MessageContext;
  handlers: PipelineHandlers;
};

/** One store at a time, highest priority first. Everything works from the keyboard. */
export function TodayQueue({
  queue,
  stores,
  ordersOnly,
  now,
  done,
  canDelete,
  sender,
  handlers,
}: Props) {
  const [position, setPosition] = useState(0);
  const index = queue.length === 0 ? 0 : Math.min(position, queue.length - 1);
  const item = queue[index];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownId = item?.id;

  // A new card takes the focus, so a screen reader hears it and the keys keep working.
  useEffect(() => {
    if (shownId) headingRef.current?.focus({ preventScroll: true });
  }, [shownId]);

  const left = queue.length;
  return (
    <div>
      <div className="mb-4">
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {left === 1 ? "1 action left today" : `${left} actions left today`}
        </p>
        <progress
          className="mt-1 h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
          value={done}
          max={Math.max(1, done + left)}
          aria-label="Today's actions done"
        />
      </div>

      {item ? (
        <QueueCard
          key={item.id}
          item={item}
          stores={stores}
          now={now}
          canDelete={canDelete}
          sender={sender}
          handlers={handlers}
          headingRef={headingRef}
          onNext={() =>
            setPosition(queue.length ? (index + 1) % queue.length : 0)
          }
          onBack={() =>
            setPosition(
              queue.length ? (index - 1 + queue.length) % queue.length : 0,
            )
          }
        />
      ) : (
        <EmptyState
          title={
            ordersOnly ? "No stores with orders waiting" : "Pipeline clear"
          }
          description="Nothing needs you right now. Build a new store to keep it moving."
          action={
            <Button asChild>
              <Link href="/admin/demo-stores/new">Build a demo store</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function QueueCard({
  item,
  stores,
  now,
  canDelete,
  sender,
  handlers,
  headingRef,
  onNext,
  onBack,
}: {
  item: PipelineItem;
  stores: PipelineItem[];
  now: Date;
  canDelete: boolean;
  sender: MessageContext;
  handlers: PipelineHandlers;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNext: () => void;
  onBack: () => void;
}) {
  const ids = useId();
  const kind = templateKindFor(item.facts, now);
  const template = templateFor(kind, item, sender);
  const [edited, setEdited] = useState<string | null>(null);
  const [name, setName] = useState(item.contactName ?? "");
  const [email, setEmail] = useState(item.contactEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const text = edited ?? template;
  const blockedOnEmail = needsClaimLink(text) && !item.contactEmail;
  const contactChanged =
    name.trim() !== (item.contactName ?? "") ||
    email.trim().toLowerCase() !== (item.contactEmail ?? "");
  const canArchive = item.facts.isDemo;

  const send = async () => {
    if (blockedOnEmail) return;
    if (await handlers.open(item, text)) handlers.markSent(item, true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsAllowed(e)) return;
      const key = e.key.toLowerCase();
      if (key === "s") void send();
      else if (key === "z") handlers.snooze(item);
      else if (key === "a" && canArchive) handlers.archive(item);
      else if (key === "j") onNext();
      else if (key === "k") onBack();
      else if (key === "u") handlers.undoLast();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <article className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-xl font-bold text-foreground focus:outline-hidden"
          >
            {item.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {item.area ? `${item.area} · ` : ""}
            <a
              href={item.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              /s/{item.slug}
            </a>
          </p>
        </div>
        <Badge>{queueReason(item.facts, now)}</Badge>
      </div>

      <HygieneChips item={item} handlers={handlers} stores={stores} />

      {item.facts.isDemo ? (
        <details className="mt-3" open={blockedOnEmail || undefined}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-foreground">
            {item.contactName || item.contactEmail
              ? [item.contactName, item.contactEmail]
                  .filter(Boolean)
                  .join(" · ")
              : "Add their name or email"}
          </summary>
          <form
            className="mt-1 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              void handlers
                .saveContact(item, { contactName: name, contactEmail: email })
                .then((ok) => {
                  if (ok) setEdited(null);
                })
                .finally(() => setSaving(false));
            }}
          >
            <div>
              <Label htmlFor={`${ids}-name`}>First name (optional)</Label>
              <Input
                id={`${ids}-name`}
                className="mt-1"
                autoComplete="off"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${ids}-email`}>
                Email, for a claim link (optional)
              </Label>
              <Input
                id={`${ids}-email`}
                className="mt-1"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={!contactChanged || saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        </details>
      ) : null}

      <div className="mt-3 space-y-2">
        <Label htmlFor={`${ids}-message`}>Message</Label>
        <textarea
          id={`${ids}-message`}
          className={`${FIELD} min-h-44`}
          value={text}
          onChange={(e) => setEdited(e.target.value)}
          onKeyDown={(e) => {
            // Back to the card, where the shortcuts work again.
            if (e.key === "Escape")
              headingRef.current?.focus({ preventScroll: true });
          }}
        />
        <p className="text-xs text-muted-foreground">
          {item.phone
            ? `Opens your WhatsApp with a chat to ${formatIndianMobile(item.phone)}. Nothing is sent until you tap send.`
            : "Add phone: none saved, so WhatsApp will ask which chat. Nothing is sent until you tap send."}
          {needsClaimLink(text)
            ? " A new claim link goes where {claimUrl} is, is emailed to them too, and voids any earlier link."
            : ""}
        </p>
        {blockedOnEmail ? (
          <Notice tone="warning" role="alert">
            Save the seller&apos;s email to include a claim link, or take{" "}
            {"{claimUrl}"} out of the message.
          </Notice>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="bg-success text-success-foreground hover:bg-success/90"
          disabled={blockedOnEmail}
          onClick={() => void send()}
        >
          <MessageCircle aria-hidden className="size-4" />
          Send <kbd className="hidden text-xs opacity-80 md:inline">S</kbd>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => handlers.snooze(item)}
        >
          Snooze {SNOOZE_DAYS}d{" "}
          <kbd className="hidden text-xs opacity-70 md:inline">Z</kbd>
        </Button>
        {canArchive ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => handlers.archive(item)}
          >
            Archive <kbd className="hidden text-xs opacity-70 md:inline">A</kbd>
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden className="size-4" />
          Back <kbd className="hidden text-xs opacity-70 md:inline">K</kbd>
        </Button>
        <Button type="button" variant="ghost" onClick={onNext}>
          Skip <kbd className="hidden text-xs opacity-70 md:inline">J</kbd>
          <ChevronRight aria-hidden className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`More actions for ${item.name}`}
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => handlers.markSent(item, false)}>
              Already messaged them
            </DropdownMenuItem>
            {canDelete && item.facts.isDemo ? (
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${item.name}?`}
        description="The store leaves this page, and its link and any claim link stop working. You can undo this for a few seconds."
        confirmLabel="Delete store"
        destructive
        onConfirm={() => handlers.remove(item)}
      />
    </article>
  );
}
