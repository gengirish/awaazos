"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { formatIstDate } from "@/lib/datetime";
import { outreachClaimMessage, outreachIntroMessage } from "@/lib/outreach-message";

const ERROR_TEXT: Record<string, string> = {
  not_a_demo_store: "This store has been claimed, so it can't be changed here.",
  not_found: "This demo store no longer exists. Refresh the page.",
};

type Props = {
  externalRef: string;
  storeName: string;
  storeUrl: string;
  /** The seller's business number saved with the store, for wa.me. */
  phone: string | null;
  /** The signed-in admin, named in the WhatsApp message. */
  senderName: string | null;
};

/**
 * A demo store's actions on /admin/demo-stores: message the seller on WhatsApp
 * (wa.me from the admin's own phone), make a claim link for their email
 * (POST …/handover) or delete the store (DELETE). Claimed stores don't get
 * this component. Nothing is sent from our side.
 */
export function DemoStoreActions({ externalRef, storeName, storeUrl, phone, senderName }: Props) {
  const router = useRouter();
  const emailId = useId();
  const [open, setOpen] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
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
        data?: { claim_url: string; expires_at: string };
      };
      if (!res.ok || !body.data) {
        setError(ERROR_TEXT[body.error ?? ""] ?? (res.status === 400 ? "Enter a valid email." : "Could not make the link. Try again."));
        return;
      }
      setLink({ url: body.data.claim_url, expiresAt: body.data.expires_at });
      setCopied(false);
      router.refresh();
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_TEXT[body.error ?? ""] ?? "Could not delete. Try again.");
        return;
      }
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
            Send it to the seller yourself. Making another link voids this one.
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
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Making…" : "Make claim link"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : messaging ? (
        <div className="space-y-3">
          <OutreachWhatsApp
            phone={phone}
            message={outreachIntroMessage({ senderName, storeName, storeUrl })}
            label="Message on WhatsApp"
          />
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
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
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
        description="The demo store, its dishes and sample orders are removed for good, and its link stops working."
        confirmLabel="Delete store"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
