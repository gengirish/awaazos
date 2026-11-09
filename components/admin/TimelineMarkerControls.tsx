"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { RadioOption } from "@/components/ui/radio-option";
import { MARKER_LABEL_MAX, MARKER_NOTE_MAX, markerInputSchema } from "@/lib/gtm-timeline";

const KINDS = [
  { value: "OUTREACH", label: "Outreach" },
  { value: "EVENT", label: "Event" },
  { value: "LAUNCH", label: "Launch" },
] as const;

/** Add a marker to the /admin/bets timeline (POST /api/admin/timeline-markers). */
export function TimelineMarkerForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("OUTREACH");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = markerInputSchema.safeParse({ kind, label, note, occurredOn });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/timeline-markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { issues?: { message?: string }[] } | null;
        setError(json?.issues?.[0]?.message ?? "Couldn't add the marker. Try again.");
        return;
      }
      setLabel("");
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn't add the marker. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="text-sm font-medium">Kind</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <RadioOption
              key={k.value}
              name={`${id}-kind`}
              label={k.label}
              checked={kind === k.value}
              onChange={() => setKind(k.value)}
              size="compact"
            />
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor={`${id}-label`}>What happened</Label>
        <Input
          id={`${id}-label`}
          value={label}
          maxLength={MARKER_LABEL_MAX}
          placeholder="Yelahanka Sunday market stall"
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor={`${id}-date`}>Day</Label>
        <Input
          id={`${id}-date`}
          type="date"
          value={occurredOn}
          min="2026-01-01"
          max="2030-12-31"
          onChange={(e) => setOccurredOn(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor={`${id}-note`}>
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${id}-note`}
          value={note}
          maxLength={MARKER_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1"
        />
      </div>
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Adding…" : "Add marker"}
      </Button>
    </form>
  );
}

/** Delete an admin marker (DELETE /api/admin/timeline-markers/[id]). */
export function TimelineMarkerDelete({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/timeline-markers/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok || res.status === 404) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="min-h-11 text-sm font-medium text-primary underline underline-offset-4 disabled:opacity-50"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
      {failed ? (
        <span role="alert" className="text-sm text-destructive">
          Couldn&apos;t delete. Try again.
        </span>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this marker?"
        description={`"${label}" comes off the timeline.`}
        confirmLabel="Delete marker"
        onConfirm={() => void remove()}
      />
    </>
  );
}
