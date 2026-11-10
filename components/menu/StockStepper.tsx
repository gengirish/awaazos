"use client";

import { AlertTriangle, Ban, Minus, Package, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stockLabel, stockState } from "@/lib/inventory";
import { onShelfCount, parseStockInput, setAsideHint } from "@/lib/menu-stock";
import { cn } from "@/lib/utils";

export type StockSaved = {
  stockQty: number | null;
  stockLeft: number | null;
  stockSetAside: number | null;
  lowStockAt: number | null;
};

type StockStepperProps = {
  item: { id: string; name: string; stockLeft: number | null; stockSetAside: number | null; lowStockAt: number | null };
  /** The server's answer, so the list (and its Low stock filter) catches up. */
  onSaved: (id: string, saved: StockSaved) => void;
};

const STEP_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground/50";

/** POST /api/menu/[id]/stock; the saved fields, or null after a toast. */
async function postStock(id: string, body: { set: number } | { adjust: number }): Promise<StockSaved | null> {
  try {
    const res = await fetch(`/api/menu/${id}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.data) {
      toast.error(json?.error === "stock_not_tracked" ? "Stock isn't tracked for this item" : "Could not update stock");
      return null;
    }
    return json.data as StockSaved;
  } catch {
    toast.error("Could not update stock");
    return null;
  }
}

/**
 * A tracked item's stock on its /menu card: the label (lib/inventory.ts
 * `stockLabel`, with an icon so the state never rests on colour), −1 / +1, and
 * "Set count". Taps show at once; a failed one is taken back with a toast.
 */
export function StockStepper({ item, onSaved }: StockStepperProps) {
  const uid = useId();
  const [left, setLeft] = useState(item.stockLeft ?? 0);
  const [setting, setSetting] = useState(false);
  const [countText, setCountText] = useState("");
  const [countError, setCountError] = useState<string | null>(null);
  const [savingCount, setSavingCount] = useState(false);
  // Taps still waiting for an answer: the server's figure only replaces the
  // optimistic one once they have all come back, so answers can't arrive out of order.
  const inFlight = useRef(0);

  useEffect(() => {
    if (inFlight.current === 0) setLeft(item.stockLeft ?? 0);
  }, [item.stockLeft]);

  async function step(delta: 1 | -1) {
    setLeft((n) => n + delta);
    inFlight.current += 1;
    const saved = await postStock(item.id, { adjust: delta });
    inFlight.current -= 1;
    if (!saved) {
      setLeft((n) => n - delta);
      return;
    }
    if (inFlight.current === 0) {
      setLeft(saved.stockLeft ?? 0);
      onSaved(item.id, saved);
    }
  }

  async function saveCount(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseStockInput(countText);
    if ("error" in parsed || parsed.value === null) {
      setCountError("error" in parsed ? parsed.error : "Enter how many you have");
      return;
    }
    setSavingCount(true);
    const saved = await postStock(item.id, { set: parsed.value });
    setSavingCount(false);
    if (!saved) return;
    setLeft(saved.stockLeft ?? 0);
    setSetting(false);
    onSaved(item.id, saved);
    toast.success(`${item.name}: ${stockLabel(saved.stockLeft, saved.lowStockAt)}`);
  }

  const state = stockState(left, item.lowStockAt);
  const Icon = state === "in_stock" ? Package : state === "low" ? AlertTriangle : Ban;
  const countId = `${uid}-count`;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p
          aria-live="polite"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 text-sm font-medium",
            state === "in_stock" && "text-foreground",
            state === "low" && "text-warning",
            (state === "sold_out" || state === "oversold") && "text-destructive",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{stockLabel(left, item.lowStockAt)}</span>
        </p>
        <button
          type="button"
          className={STEP_BUTTON}
          disabled={left <= 0}
          onClick={() => void step(-1)}
          aria-label={`One less ${item.name}`}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={STEP_BUTTON} onClick={() => void step(1)} aria-label={`One more ${item.name}`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {setting ? (
        <form onSubmit={saveCount} className="space-y-1">
          <label htmlFor={countId} className="block text-xs font-medium text-muted-foreground">
            How many do you have now?
          </label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {setAsideHint(item.stockSetAside)}
          </p>
          <div className="flex gap-2">
            <Input
              id={countId}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={countText}
              aria-invalid={countError ? true : undefined}
              aria-describedby={countError ? `${hintId} ${errorId}` : hintId}
              onChange={(e) => {
                setCountText(e.target.value);
                setCountError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSetting(false);
              }}
              className="h-11 min-w-0 flex-1"
            />
            <Button type="submit" className="min-h-11" disabled={savingCount}>
              Save
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setSetting(false)}>
              Cancel
            </Button>
          </div>
          {countError ? (
            <p id={errorId} className="text-xs text-destructive">
              {countError}
            </p>
          ) : null}
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 w-full"
          onClick={() => {
            // The shelf, not what's left: pieces packed for open orders are still here (rule 2b).
            setCountText(String(onShelfCount({ stockLeft: left, stockSetAside: item.stockSetAside })));
            setCountError(null);
            setSetting(true);
          }}
          aria-label={`Set stock count for ${item.name}`}
        >
          Set count
        </Button>
      )}
    </div>
  );
}
