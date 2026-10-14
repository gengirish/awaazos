"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { formatIstDate } from "@/lib/datetime";

const ERROR_TEXT: Record<string, string> = {
  not_a_demo_store: "This store has been claimed, so it can't be changed here.",
  not_found: "This demo store no longer exists. Refresh the page.",
};

type Props = { externalRef: string; storeName: string };

/**
 * A demo store's actions on /admin/demo-stores: make a claim link for the
 * seller's email (POST …/handover) or delete the store (DELETE). Claimed stores
 * don't get this component. Nothing is sent to anyone.
 */
export function DemoStoreActions({ externalRef, storeName }: Props) {
  const router = useRouter();
  const emailId = useId();
  const [open, setOpen] = useState(false);
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
          <Button type="button" size="sm" onClick={() => void copy(link.url)}>
            {copied ? "Copied" : "Copy claim link"}
          </Button>
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
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
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
