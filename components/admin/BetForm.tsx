"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { RadioOption } from "@/components/ui/radio-option";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BET_ERROR_TEXT,
  BET_HYPOTHESIS_MAX,
  BET_METRICS,
  BET_METRIC_KEYS,
  BET_NOTES_MAX,
  BET_TITLE_MAX,
  type BetMetricKey,
  type BetOutput,
  betInputSchema,
  isBetMetricKey,
  parseTargetInput,
  targetToInput,
} from "@/lib/admin-bets";

const FIELD =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const UNIT_HINT = { percent: "%, such as 30 or 12.5", count: "a whole number", paise: "₹, such as 25000" } as const;

type Props = {
  /** Editing this bet; a new bet when absent. */
  bet?: BetOutput;
  /** Called after a save or delete, once the page data is refreshing. */
  onDone?: () => void;
};

/**
 * Create or edit a bet on /admin/bets. The whole bet is sent every time
 * (POST /api/admin/bets or PATCH /api/admin/bets/[id]); the route checks it again.
 */
export function BetForm({ bet, onDone }: Props) {
  const router = useRouter();
  const id = useId();
  const initialKey: BetMetricKey = bet && isBetMetricKey(bet.metricKey) ? bet.metricKey : "voice_share";
  const [title, setTitle] = useState(bet?.title ?? "");
  const [hypothesis, setHypothesis] = useState(bet?.hypothesis ?? "");
  const [metricKey, setMetricKey] = useState<BetMetricKey>(initialKey);
  const [comparator, setComparator] = useState<"GTE" | "LTE">(bet?.comparator ?? "GTE");
  const [target, setTarget] = useState(bet ? targetToInput(BET_METRICS[initialKey].unit, bet.targetValue) : "");
  const [deadline, setDeadline] = useState(bet?.deadline ?? "");
  const [decision, setDecision] = useState<BetOutput["decision"]>(bet?.decision ?? "PENDING");
  const [notes, setNotes] = useState(bet?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const unit = BET_METRICS[metricKey].unit;

  async function send(method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(bet ? `/api/admin/bets/${encodeURIComponent(bet.id)}` : "/api/admin/bets", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string; issues?: { message?: string }[] } | null;
        setError(BET_ERROR_TEXT[json?.error ?? ""] ?? json?.issues?.[0]?.message ?? "Couldn't save. Try again.");
        return false;
      }
      router.refresh();
      onDone?.();
      return true;
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const targetValue = parseTargetInput(unit, target);
    if (targetValue === null) {
      setError(`Enter the target as ${UNIT_HINT[unit]}.`);
      return;
    }
    const parsed = betInputSchema.safeParse({ title, hypothesis, metricKey, targetValue, comparator, deadline, decision, notes });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields.");
      return;
    }
    const ok = await send(bet ? "PATCH" : "POST", parsed.data);
    if (ok && !bet) {
      setTitle("");
      setHypothesis("");
      setTarget("");
      setDeadline("");
      setDecision("PENDING");
      setNotes("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={BET_TITLE_MAX}
          placeholder="Voice billing"
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor={`${id}-hypothesis`}>Hypothesis, and what happens if it fails</Label>
        <textarea
          id={`${id}-hypothesis`}
          value={hypothesis}
          maxLength={BET_HYPOTHESIS_MAX}
          onChange={(e) => setHypothesis(e.target.value)}
          className={`${FIELD} mt-1 min-h-24 text-sm`}
          required
        />
      </div>
      <div>
        <Label htmlFor={`${id}-metric`}>Metric</Label>
        <Select value={metricKey} onValueChange={(v) => isBetMetricKey(v) && setMetricKey(v)}>
          <SelectTrigger id={`${id}-metric`} className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BET_METRIC_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {BET_METRICS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{BET_METRICS[metricKey].help} Last 7 complete days.</p>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Target</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <RadioOption
            name={`${id}-comparator`}
            label="At least"
            checked={comparator === "GTE"}
            onChange={() => setComparator("GTE")}
            size="compact"
          />
          <RadioOption
            name={`${id}-comparator`}
            label="At most"
            checked={comparator === "LTE"}
            onChange={() => setComparator("LTE")}
            size="compact"
          />
        </div>
        <Label htmlFor={`${id}-target`} className="sr-only">
          Target value
        </Label>
        <Input
          id={`${id}-target`}
          value={target}
          inputMode="decimal"
          onChange={(e) => setTarget(e.target.value)}
          className="mt-2"
          aria-describedby={`${id}-target-hint`}
          required
        />
        <p id={`${id}-target-hint`} className="mt-1 text-xs text-muted-foreground">
          In {UNIT_HINT[unit]}
        </p>
      </fieldset>
      <div>
        <Label htmlFor={`${id}-deadline`}>Deadline (the last day counts)</Label>
        <Input
          id={`${id}-deadline`}
          type="date"
          value={deadline}
          min="2026-01-01"
          max="2030-12-31"
          onChange={(e) => setDeadline(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Decision</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {(["PENDING", "KEEP", "KILL"] as const).map((d) => (
            <RadioOption
              key={d}
              name={`${id}-decision`}
              label={d === "PENDING" ? "Pending" : d === "KEEP" ? "Keep" : "Kill"}
              checked={decision === d}
              onChange={() => setDecision(d)}
              size="compact"
            />
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor={`${id}-notes`}>
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <textarea
          id={`${id}-notes`}
          value={notes}
          maxLength={BET_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
          className={`${FIELD} mt-1 min-h-20 text-sm`}
        />
      </div>
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : bet ? "Save bet" : "Add bet"}
        </Button>
        {bet ? (
          <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        ) : null}
      </div>
      {bet ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this bet?"
          description={`"${bet.title}" and its notes go for good.`}
          confirmLabel="Delete bet"
          onConfirm={() => void send("DELETE")}
        />
      ) : null}
    </form>
  );
}
