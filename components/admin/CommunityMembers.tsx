"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { COMMUNITY_ERROR_TEXT } from "@/lib/community";

export type CommunityMemberRow = {
  vendorId: string;
  name: string;
  slug: string;
  accepted: boolean;
  /** Accepted, but the page leaves it out: its store page is off or it is inactive. */
  hidden: boolean;
};

type Props = {
  communityId: string;
  communityName: string;
  members: CommunityMemberRow[];
};

/**
 * Stores on one community page (/admin/communities): invite by store link,
 * take a store off, delete the page. An invite lists nothing until the store's
 * owner accepts in Settings → Online store.
 */
export function CommunityMembers({ communityId, communityName, members }: Props) {
  const router = useRouter();
  const inputId = useId();
  const [store, setStore] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CommunityMemberRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const base = `/api/admin/communities/${encodeURIComponent(communityId)}`;

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(COMMUNITY_ERROR_TEXT[body?.error ?? ""] ?? "That didn't work. Try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("That didn't work. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!store.trim()) return;
    const ok = await call(`${base}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store }),
    });
    if (ok) {
      setStore("");
      setNotice("Invited. Ask the owner to accept it in Settings → Online store.");
    }
  }

  return (
    <div className="space-y-4">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stores yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.vendorId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">/s/{m.slug}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.accepted ? (
                  m.hidden ? (
                    <Badge variant="secondary">Accepted · store page off</Badge>
                  ) : (
                    <Badge>Listed</Badge>
                  )
                ) : (
                  <Badge variant="outline">Invited</Badge>
                )}
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRemoving(m)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor={inputId}>Invite a store by its link</Label>
          <Input
            id={inputId}
            value={store}
            placeholder="awaazos.intelliforge.tech/s/ravis-bhel"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setStore(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy || !store.trim()}>
          Invite
        </Button>
      </form>

      <div aria-live="polite">
        {error ? (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        ) : notice ? (
          <p role="status" className="text-sm text-foreground">
            {notice}
          </p>
        ) : null}
      </div>

      <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setDeleteOpen(true)}>
        Delete this page
      </Button>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Take ${removing?.name ?? "this store"} off ${communityName}?`}
        description="The store itself is not changed. You can invite it again later."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) void call(`${base}/members/${encodeURIComponent(removing.vendorId)}`, { method: "DELETE" });
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${communityName}?`}
        description="The page and its link stop working at once. The stores on it are not changed."
        confirmLabel="Delete page"
        onConfirm={() => void call(base, { method: "DELETE" })}
      />
    </div>
  );
}
