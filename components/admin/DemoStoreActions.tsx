"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { formatIstDate } from "@/lib/datetime";
import { outreachClaimMessage } from "@/lib/outreach-message";

const ERROR_TEXT: Record<string, string> = {
  not_a_demo_store: "This store has been claimed, so it can't be changed here.",
  not_found: "This demo store no longer exists. Refresh the page.",
};

type Props = {
  externalRef: string;
  storeName: string;
  /** The seller's business number saved with the store, for wa.me. */
  phone: string | null;
  /** The message for this store's next send, with its tokens filled in. */
  message: string;
  /** Saved earlier, so a new claim link needn't ask again. */
  contactEmail: string | null;
  /** A SALES user can't delete a store. */
  canDelete: boolean;
  /** WhatsApp was opened, or the admin says they already messaged the seller. */
  onSent: (opened: boolean) => void;
  onArchive: () => void;
  onDelete: () => void;
};

/**
 * A demo store's actions on /admin/demo-stores: message the seller on WhatsApp
 * (wa.me from the admin's own phone, recorded as sent), or email them a claim
 * link (POST …/handover). Archive and delete sit in the ⋯ menu, away from the
 * primary action. Claimed stores don't get this component. The claim email is
 * the only thing sent from our side.
 */
export function DemoStoreActions({
  externalRef,
  storeName,
  phone,
  message,
  contactEmail,
  canDelete,
  onSent,
  onArchive,
  onDelete,
}: Props) {
  const router = useRouter();
  const emailId = useId();
  const [open, setOpen] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [email, setEmail] = useState(contactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/api/admin/demo-stores/${encodeURIComponent(externalRef)}`;

  async function makeLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the seller's email.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: email.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { claim_url: string; expires_at: string; emailed: boolean };
      };
      if (!res.ok || !body.data) {
        setError(ERROR_TEXT[body.error ?? ""] ?? (res.status === 400 ? "Enter a valid email." : "Could not make the link. Try again."));
        return;
      }
      setLink({ url: body.data.claim_url, expiresAt: body.data.expires_at, emailed: body.data.emailed });
      setCopied(false);
      router.refresh();
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {link ? (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium text-foreground">
            Claim link for {email.trim()}, works once until {formatIstDate(new Date(link.expiresAt))}:
          </p>
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{link.url}</p>
          <p className="text-xs text-muted-foreground">
            {link.emailed
              ? "We emailed it to the seller. A mistyped address won't show an error here, so check it. "
              : "We couldn't email it, so send it to the seller yourself. "}
            Making another link voids this one.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(link.url)}>
            {copied ? "Copied" : "Copy claim link"}
          </Button>
          <OutreachWhatsApp
            phone={phone}
            message={outreachClaimMessage({
              storeName,
              claimUrl: link.url,
              expiresOn: formatIstDate(new Date(link.expiresAt)),
            })}
            label="Send claim link on WhatsApp"
            onOpen={() => onSent(true)}
          />
        </div>
      ) : open ? (
        <form onSubmit={makeLink} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="w-full sm:w-72">
            <Label htmlFor={emailId}>Seller&apos;s email</Label>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="off"
              className="mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">
              We email the claim link here, and their account uses this address. Check the spelling.
            </p>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email claim link"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : messaging ? (
        <div className="space-y-3">
          <OutreachWhatsApp phone={phone} message={message} label="Message on WhatsApp" onOpen={() => onSent(true)} />
          <Button type="button" size="sm" variant="outline" onClick={() => setMessaging(false)}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="sm" onClick={() => setMessaging(true)}>
            Message on WhatsApp
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            Hand over to the seller
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="outline" aria-label={`More actions for ${storeName}`}>
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onSent(false)}>Already messaged them</DropdownMenuItem>
              <DropdownMenuItem onSelect={onArchive}>Archive</DropdownMenuItem>
              {canDelete ? (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(true)}>
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${storeName}?`}
        description="The store leaves this page, and its link and any claim link stop working. You can undo this for a few seconds."
        confirmLabel="Delete store"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}
