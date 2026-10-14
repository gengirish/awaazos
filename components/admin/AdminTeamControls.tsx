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
  already_admin: "That account is already an admin.",
  cannot_remove_self: "You can't remove yourself.",
  not_found: "Already gone. Refresh the page.",
};

/** /admin/admins: make a one-time admin invite link for an email. */
export function AdminInviteCreate() {
  const router = useRouter();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Enter their email.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/admins/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { invite_url: string; expires_at: string };
      };
      if (!res.ok || !body.data) {
        setError(ERROR_TEXT[body.error ?? ""] ?? (res.status === 400 ? "Enter a valid email." : "Could not make the invite. Try again."));
        return;
      }
      setLink({ url: body.data.invite_url, expiresAt: body.data.expires_at, email: value });
      setEmail("");
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
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="w-full sm:w-72">
          <Label htmlFor={emailId}>Their email</Label>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="off"
            className="mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Making…" : "Make invite link"}
        </Button>
      </form>
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      {link ? (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium text-foreground">
            Invite for {link.email}, works once until {formatIstDate(new Date(link.expiresAt))}:
          </p>
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{link.url}</p>
          <p className="text-xs text-muted-foreground">
            This is the only time the link is shown. Send it to them yourself; anyone with it can join as this email.
          </p>
          <Button type="button" size="sm" onClick={() => void copy(link.url)}>
            {copied ? "Copied" : "Copy invite link"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function useDeleteAction(url: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_TEXT[body.error ?? ""] ?? "Could not do that. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Void a pending admin invite. */
export function AdminInviteRevoke({ inviteId, email }: { inviteId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useDeleteAction(`/api/admin/admins/invites/${encodeURIComponent(inviteId)}`);
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        Void invite
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Void the invite for ${email}?`}
        description="The link stops working. You can make a new one later."
        confirmLabel="Void invite"
        destructive
        onConfirm={run}
      />
    </div>
  );
}

/** Take an ADMIN back to a normal account. */
export function AdminRemove({ userId, label }: { userId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useDeleteAction(`/api/admin/admins/${encodeURIComponent(userId)}`);
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        Remove
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${label} as admin?`}
        description="They lose the admin pages at once. Their account and the demo stores they built stay."
        confirmLabel="Remove admin"
        destructive
        onConfirm={run}
      />
    </div>
  );
}
