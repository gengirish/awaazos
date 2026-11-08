"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";

import type { MessageContext, PipelineHandlers } from "@/components/admin/pipeline/PipelineClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { PipelineItem } from "@/lib/demo-pipeline-server";
import { fillTemplate, needsClaimLink } from "@/lib/demo-pipeline";
import { outreachTemplate } from "@/lib/outreach-message";
import { formatIndianMobile } from "@/lib/phone";

const FIELD =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type Props = {
  items: PipelineItem[];
  sender: MessageContext;
  handlers: PipelineHandlers;
  onClose: () => void;
};

/**
 * One message template, then one store at a time: WhatsApp opens, the admin sends
 * it there and comes back to confirm. Nothing is recorded until they say Sent, and
 * nothing goes out from our side.
 */
export function BulkSendDialog({ items, sender, handlers, onClose }: Props) {
  const ids = useId();
  const [template, setTemplate] = useState(() => outreachTemplate("intro", sender));
  const [index, setIndex] = useState<number | null>(null);
  const [sent, setSent] = useState(0);

  const fill = (item: PipelineItem) =>
    fillTemplate(template, {
      firstName: item.contactName,
      storeName: item.name,
      storeUrl: item.storeUrl,
      area: item.area,
    });
  const blocked = (item: PipelineItem) => needsClaimLink(template) && !item.contactEmail;

  const current = index !== null ? items[index] : undefined;
  const finished = index !== null && !current;

  /** Moves to a store and opens its chat, inside the tap that got us here. */
  function goTo(next: number) {
    setIndex(next);
    const item = items[next];
    if (item && !blocked(item)) void handlers.open(item, fill(item));
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {finished
              ? "All done"
              : current
                ? `${index! + 1} of ${items.length}: ${current.name}`
                : `Send invites to ${items.length} ${items.length === 1 ? "store" : "stores"}`}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {finished
              ? `Marked ${sent} ${sent === 1 ? "store" : "stores"} as sent.`
              : current
                ? "Send it in WhatsApp, then come back and confirm."
                : "Nothing is sent until you tap send in WhatsApp, one chat at a time."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {finished ? null : (
          <ResponsiveDialogBody className="space-y-3">
            {current ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {current.phone ? `To ${formatIndianMobile(current.phone)}` : "Add phone: WhatsApp will ask which chat."}
                </p>
                <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{fill(current)}</p>
                {blocked(current) ? (
                  <Notice tone="warning">
                    This store has no saved email, so it can&apos;t get a claim link. Skip it, and save the email on its
                    card first.
                  </Notice>
                ) : null}
              </>
            ) : (
              <>
                <Label htmlFor={`${ids}-template`}>Message</Label>
                <textarea
                  id={`${ids}-template`}
                  className={`${FIELD} min-h-44`}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  You can use {"{firstName} {storeName} {storeUrl} {claimUrl} {area}"}. {"{claimUrl}"} makes a new link for
                  each store, emailed to them too, and needs their saved email.
                </p>
                <p className="text-sm font-medium text-foreground">Preview for {items[0]?.name}</p>
                <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{items[0] ? fill(items[0]) : null}</p>
              </>
            )}
          </ResponsiveDialogBody>
        )}

        <ResponsiveDialogFooter>
          {finished ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : current ? (
            <>
              <Button type="button" variant="outline" onClick={() => goTo(index! + 1)}>
                Skip
              </Button>
              {blocked(current) ? null : (
                <>
                  <Button type="button" variant="outline" onClick={() => void handlers.open(current, fill(current))}>
                    Open again
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      handlers.markSent(current, true, true);
                      setSent((n) => n + 1);
                      goTo(index! + 1);
                    }}
                  >
                    <Check aria-hidden className="size-4" />
                    Sent
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={() => goTo(0)}>
                Start sending
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
