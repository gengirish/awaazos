"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { addMonthsYmd, formatYmd, FREE_ACCESS_PRESET_MONTHS, parseFreeUntil } from "@/lib/admin-free-access";

const ERROR_TEXT: Record<string, string> = {
  invalid_date: "Pick a date.",
  in_past: "Pick today or a later date.",
  too_far: "That is too far ahead. Pick a date within 24 months.",
};

type Props = {
  vendorId: string;
  vendorName: string;
  /** The store's current free-until day (IST), when it is still ahead. */
  currentYmd: string | null;
  /** IST today and the furthest day allowed, from the server render. */
  todayYmd: string;
  maxYmd: string;
};

/**
 * "Free until" date for one store on /admin/vendors. The server validates
 * again (PATCH /api/admin/vendors/[id]/free-access); this only previews.
 */
export function FreeAccessForm({ vendorId, vendorName, currentYmd, todayYmd, maxYmd }: Props) {
  const router = useRouter();
  const inputId = useId();
  const [ymd, setYmd] = useState(currentYmd ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedYmd, setSavedYmd] = useState<string | null>(null);

  function pick(next: string) {
    setYmd(next);
    setError(null);
    setSavedYmd(null);
  }

  function askToSave() {
    const parsed = parseFreeUntil(ymd);
    if (!parsed.ok) {
      setError(ERROR_TEXT[parsed.error]);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function save() {
    setSaving(true);
    setSavedYmd(null);
    try {
      const res = await fetch(`/api/admin/vendors/${encodeURIComponent(vendorId)}/free-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeUntil: ymd }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(ERROR_TEXT[body?.error ?? ""] ?? "Could not save. Try again.");
        return;
      }
      setSavedYmd(ymd);
      router.refresh();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const shortens = currentYmd !== null && ymd !== "" && ymd < currentYmd;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <Label htmlFor={inputId}>Free until</Label>
          <Input
            id={inputId}
            type="date"
            className="mt-1 sm:w-44"
            value={ymd}
            min={todayYmd}
            max={maxYmd}
            onChange={(e) => pick(e.target.value)}
          />
        </div>
        <Button type="button" disabled={saving || ymd === "" || ymd === currentYmd} onClick={askToSave}>
          {saving ? "Saving…" : "Give free access"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">From today:</span>
        {FREE_ACCESS_PRESET_MONTHS.map((months) => (
          <Button
            key={months}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => pick(addMonthsYmd(todayYmd, months))}
          >
            {months} {months === 1 ? "month" : "months"}
          </Button>
        ))}
      </div>

      {error ? (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      ) : null}
      <p role="status" className="text-sm font-medium text-emerald-700 empty:hidden dark:text-emerald-400">
        {savedYmd ? `Saved. Free until ${formatYmd(savedYmd)}.` : null}
      </p>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Give ${vendorName} free access until ${formatYmd(ymd)}?`}
        description={
          shortens && currentYmd
            ? `This is earlier than their current date, ${formatYmd(currentYmd)}. After ${formatYmd(ymd)} they must subscribe to keep selling.`
            : "They keep Starter features and are not charged before that date. After it they must subscribe to keep selling."
        }
        confirmLabel="Give free access"
        destructive={shortens}
        onConfirm={save}
      />
    </div>
  );
}
