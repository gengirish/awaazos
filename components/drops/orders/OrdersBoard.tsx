"use client";

import type { FulfilmentMode } from "@prisma/client";
import { ChefHat, ExternalLink, Loader2, Pencil, RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BulkActionBar } from "@/components/drops/orders/BulkActionBar";
import { OrderCard } from "@/components/drops/orders/OrderCard";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { PushAlertsButton } from "@/components/push/PushAlertsButton";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/currency";
import type { EffectiveDropStatus } from "@/lib/drops";
import {
  BOARD_FILTERS,
  DROP_STATUS_LABEL,
  countByFilter,
  filterOrders,
  firstName,
  liveEffectiveStatus,
  newOrderIds,
  prepFromOrders,
  shouldPollForOrders,
  summarizeOrders,
  type BoardFilter,
  type BoardOrder,
  type OrderAction,
} from "@/lib/drops-board";
import type { BoardDrop } from "@/lib/drops-board-server";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import {
  BOARD_POLL_MS,
  menuBoardPollKind,
  toMakeFromOrders,
} from "@/lib/menu-orders-board";
import {
  BULK_ORDER_MAX,
  bulkActionCounts,
  bulkResultMessage,
  bulkTargets,
  isBulkSelectable,
  pruneSelection,
  type BulkOrderAction,
  type BulkOrderResult,
} from "@/lib/order-bulk";
import { cn } from "@/lib/utils";

const MAX_TIMEOUT_MS = 2_147_483_647;
/** Coming back to the tab (e.g. tapping a push alert) refetches at most this often. */
const VISIBLE_REFETCH_MIN_MS = 30_000;
/** Per-device Sound choice. Audio still needs a tap to unlock after a reload. */
const SOUND_PREF_KEY = "awz_board_sound_v1";

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREF_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREF_KEY, on ? "on" : "off");
  } catch {
    // Blocked storage: the choice just isn't remembered.
  }
}

/**
 * Which orders the board shows: one Drop's pre-orders (cut-off, prep sheet,
 * frozen rule), or the "order from menu" orders (storefront, no drop), which
 * have no cut-off and poll only while the vendor has the setting switched on.
 */
export type OrdersBoardSource =
  | { kind: "drop"; initialDrop: BoardDrop }
  | { kind: "menu"; acceptMenuOrders: boolean; fulfilmentMode: FulfilmentMode };

type Props = {
  vendorName: string;
  vendorSlug: string;
  source: OrdersBoardSource;
  initialOrders: BoardOrder[];
  initialSignal: number | null;
};

type OrdersResponse = { data: BoardOrder[]; drop?: BoardDrop; signal: number | null };
type BulkResponse = { data?: BulkOrderResult & { orders: BoardOrder[] }; error?: string };

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function boardUrls(source: OrdersBoardSource): { orders: string; signal: string; actionBase: string } {
  if (source.kind === "menu") {
    return {
      orders: "/api/storefront-orders",
      signal: "/api/storefront-orders/signal",
      actionBase: "/api/storefront-orders",
    };
  }
  const base = `/api/drops/${encodeURIComponent(source.initialDrop.id)}`;
  return { orders: `${base}/orders`, signal: `${base}/signal`, actionBase: `${base}/orders` };
}

const MENU_MODE_LABEL: Record<FulfilmentMode, string> = {
  PICKUP: "Pickup only",
  DELIVERY: "Delivery only",
  BOTH: "Delivery or pickup",
};

const ACTION_DONE: Record<OrderAction, string> = {
  confirm: "Order confirmed",
  mark_paid: "Marked paid",
  cancel: "Order cancelled",
  deliver: "Marked delivered",
  undeliver: "Moved back to confirmed",
};

const LINK_BTN =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

function beep(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // Audio is a nicety; the aria-live announcement and "New" badge still fire.
  }
}

export function OrdersBoard({ vendorName, vendorSlug, source, initialOrders, initialSignal }: Props) {
  const isMenu = source.kind === "menu";
  const [drop, setDrop] = useState<BoardDrop | null>(source.kind === "drop" ? source.initialDrop : null);
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<BoardFilter>("needs_action");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<{ orderId: string; action: OrderAction } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [bulkPending, setBulkPending] = useState<BulkOrderAction | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  /** Saved choice was "on" but audio is still locked until the first tap. */
  const [soundPending, setSoundPending] = useState(false);
  /** Last successful check for new orders (orders fetch or signal check). Set after mount. */
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  /** null = KV unavailable → fallback mode. */
  const [signalMode, setSignalMode] = useState<"kv" | "fallback">(initialSignal === null ? "fallback" : "kv");

  const signalRef = useRef<number | null>(initialSignal);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const inFlight = useRef(false);
  const lastVisibleRefetch = useRef(0);

  // A page never switches source, so these strings are stable for its lifetime.
  const { orders: ordersUrl, signal: signalUrl, actionBase } = boardUrls(source);

  const effective: EffectiveDropStatus | null = drop ? liveEffectiveStatus(drop, now) : null;
  const frozen = drop ? drop.status === "FROZEN" || drop.status === "FULFILLED" : false;

  const refresh = useCallback(async (opts?: { manual?: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (opts?.manual) setRefreshing(true);
    try {
      const res = await fetch(ordersUrl, { cache: "no-store" });
      if (!res.ok) {
        if (opts?.manual) toast.error("Could not refresh orders");
        return;
      }
      const body = (await res.json()) as OrdersResponse;
      const fresh = newOrderIds(ordersRef.current, body.data);
      if (fresh.length > 0) {
        const newest = body.data.find((o) => o.id === fresh[0]);
        setAnnouncement(
          fresh.length === 1
            ? `New order from ${firstName(newest?.customerName)}`
            : `${fresh.length} new orders, latest from ${firstName(newest?.customerName)}`,
        );
        setNewIds((prev) => new Set([...Array.from(prev), ...fresh]));
        if (soundRef.current) beep(audioRef.current);
      }
      signalRef.current = body.signal;
      setSignalMode(body.signal === null ? "fallback" : "kv");
      setOrders(body.data);
      if (body.drop) setDrop(body.drop);
      setNow(new Date());
      setLastChecked(new Date());
    } catch {
      if (opts?.manual) toast.error("Could not refresh orders. Check your internet.");
    } finally {
      inFlight.current = false;
      if (opts?.manual) setRefreshing(false);
    }
  }, [ordersUrl]);

  // Re-render exactly when the drop opens / closes, so polling starts / stops on
  // time without a network call. Pure client timer — touches nothing remote.
  // (Menu board: no drop, no edges, no timer.)
  const opensAt = drop?.opensAt ?? null;
  const closesAtIso = drop?.closesAt ?? null;
  useEffect(() => {
    const t = Date.now();
    const edges = [opensAt, closesAtIso]
      .filter((x): x is string => Boolean(x))
      .map((x) => new Date(x).getTime() - t)
      .filter((ms) => ms > 0);
    if (edges.length === 0) return;
    const id = window.setTimeout(() => setNow(new Date()), Math.min(Math.min(...edges) + 500, MAX_TIMEOUT_MS));
    return () => window.clearTimeout(id);
  }, [opensAt, closesAtIso, now]);

  // New-order detection without pinning Neon awake. Instant alerts come from Web
  // Push (lib/push.ts); polling is only a fallback, so BOTH boards tick every 6 min —
  // above Neon's 5-min idle timeout, since each tick's session check reads Postgres.
  //  - KV available: read the Upstash counter, refetch only when it moves.
  //  - No KV: refetch directly, only while OPEN.
  //  - Only while the tab is visible; returning to the tab refetches once.
  //  - Drop board: nothing at all once orders are closed. Menu board: only while
  //    "order from menu" is switched on.
  const pollKind: "signal" | "fallback" | null =
    source.kind === "menu"
      ? menuBoardPollKind(source.acceptMenuOrders, signalMode)
      : !effective || !shouldPollForOrders(effective)
        ? null
        : signalMode === "kv"
          ? "signal"
          : effective === "OPEN"
            ? "fallback"
            : null;

  useEffect(() => {
    if (!pollKind) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (pollKind === "fallback") {
        await refresh();
        return;
      }
      try {
        const res = await fetch(signalUrl, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { signal } = (await res.json()) as { signal: number | null };
        if (signal === null) {
          setSignalMode("fallback");
          return;
        }
        if (signal !== signalRef.current) await refresh();
        else setLastChecked(new Date());
      } catch {
        // Offline for a moment; next tick retries.
      }
    };

    const id = window.setInterval(tick, BOARD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollKind, signalUrl, refresh]);

  // The server-rendered orders were just fetched; start the clock on mount
  // (not during render) so server and client markup match.
  useEffect(() => {
    setLastChecked(new Date());
    lastVisibleRefetch.current = Date.now();
  }, []);

  // Returning to the tab (unlocking the phone, tapping a push alert) refetches
  // once, at most every 30 s. Event-driven, not polling: nothing runs while the
  // tab stays hidden, so it never keeps Neon awake.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      if (t - lastVisibleRefetch.current < VISIBLE_REFETCH_MIN_MS) return;
      lastVisibleRefetch.current = t;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Created inside a tap, so mobile browsers allow it to play later.
  const unlockAudio = useCallback((withBeep: boolean) => {
    try {
      if (!audioRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        audioRef.current = Ctor ? new Ctor() : null;
      }
      void audioRef.current?.resume();
      if (withBeep) beep(audioRef.current);
    } catch {
      audioRef.current = null;
    }
  }, []);

  // Restore the per-device Sound choice. Browsers block audio until a tap, so a
  // saved "on" waits for the first tap anywhere on the page.
  useEffect(() => {
    if (readSoundPref()) setSoundPending(true);
  }, []);

  useEffect(() => {
    if (!soundPending) return;
    const onTap = (e: Event) => {
      // The Sound button handles its own tap.
      if (e.target instanceof Element && e.target.closest("[data-sound-toggle]")) return;
      unlockAudio(false);
      setSoundOn(true);
      setSoundPending(false);
    };
    document.addEventListener("click", onTap, true);
    return () => document.removeEventListener("click", onTap, true);
  }, [soundPending, unlockAudio]);

  const toggleSound = () => {
    const turnOn = soundPending || !soundOn;
    if (turnOn) unlockAudio(true);
    setSoundPending(false);
    setSoundOn(turnOn);
    writeSoundPref(turnOn);
  };

  const runAction = async (orderId: string, action: OrderAction) => {
    setPending({ orderId, action });
    try {
      const res = await fetch(`${actionBase}/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: BoardOrder; error?: string };
      if (res.ok && body.data) {
        const updated = body.data;
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(updated.id);
          return next;
        });
        toast.success(ACTION_DONE[action]);
        return;
      }
      if (body.error === "drop_frozen") {
        toast.error("Orders are frozen. Only payment and delivery can change now.");
      } else if (body.error === "invalid_state") {
        toast.error("This order changed on another device. Refreshed.");
      } else if (res.status === 404) {
        toast.error("Order not found.");
      } else {
        toast.error("Could not update the order. Try again.");
      }
      await refresh();
    } catch {
      toast.error("No internet. The order was not changed.");
    } finally {
      setPending(null);
    }
  };

  const summary = useMemo(() => summarizeOrders(orders), [orders]);
  const dropItems = drop?.items;
  const prep = useMemo(() => (dropItems ? prepFromOrders(dropItems, orders) : []), [dropItems, orders]);
  const toMake = useMemo(() => (isMenu ? toMakeFromOrders(orders) : []), [isMenu, orders]);
  const counts = useMemo(() => countByFilter(orders), [orders]);
  const visible = useMemo(() => filterOrders(orders, filter), [orders, filter]);
  const toCook = prep.filter((p) => p.qtyOrdered > 0);

  // Selection is limited to what is on screen and still actionable: derived, so
  // a refetch that moves an order to another tab silently drops it.
  const activeSelected = useMemo(() => pruneSelection(selected, visible, frozen), [selected, visible, frozen]);
  const selectableVisible = useMemo(() => visible.filter((o) => isBulkSelectable(o, frozen)), [visible, frozen]);
  const bulkCounts = useMemo(() => bulkActionCounts(visible, activeSelected, frozen), [visible, activeSelected, frozen]);
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((o) => activeSelected.has(o.id));
  const someSelected = activeSelected.size > 0 && !allSelected;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleSelect = useCallback((orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    setSelected(allSelected ? EMPTY_SELECTION : new Set(selectableVisible.map((o) => o.id)));
  };

  const changeFilter = (f: BoardFilter) => {
    setFilter(f);
    setSelected(EMPTY_SELECTION);
  };

  const targetsFor = (action: BulkOrderAction) => bulkTargets(visible, activeSelected, action, frozen);

  const runBulk = async (action: BulkOrderAction) => {
    const ids = targetsFor(action).map((o) => o.id);
    if (ids.length === 0) return;
    setBulkPending(action);
    const result: BulkOrderResult = { succeeded: [], failed: [] };
    const changed: BoardOrder[] = [];
    let requestFailed = false;
    try {
      // The route takes at most 50 ids; a big drop goes in a few calls, one after another.
      for (let i = 0; i < ids.length; i += BULK_ORDER_MAX) {
        const chunk = ids.slice(i, i + BULK_ORDER_MAX);
        const res = await fetch(`${actionBase}/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: chunk, action }),
        });
        const body = (await res.json().catch(() => ({}))) as BulkResponse;
        if (!res.ok || !body.data) {
          requestFailed = true;
          break;
        }
        result.succeeded.push(...body.data.succeeded);
        result.failed.push(...body.data.failed);
        changed.push(...body.data.orders);
      }
    } catch {
      requestFailed = true;
    }

    if (changed.length > 0) {
      const byId = new Map(changed.map((o) => [o.id, o]));
      setOrders((prev) => prev.map((o) => byId.get(o.id) ?? o));
      setNewIds((prev) => {
        const next = new Set(prev);
        changed.forEach((o) => next.delete(o.id));
        return next;
      });
    }
    setSelected(EMPTY_SELECTION);
    setBulkPending(null);

    if (requestFailed) {
      toast.error(
        result.succeeded.length > 0
          ? `${result.succeeded.length} changed, then the connection dropped. Refreshed.`
          : "Could not update the orders. Check your internet and try again.",
      );
      await refresh();
      return;
    }
    const msg = bulkResultMessage(action, result);
    if (msg.kind === "success") toast.success(msg.text);
    else toast.error(msg.text);
    if (result.failed.length > 0) await refresh();
  };

  const controls = (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => void refresh({ manual: true })}
        disabled={refreshing}
        aria-busy={refreshing}
      >
        {refreshing ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        Refresh
      </Button>
      {lastChecked && (
        <span className="text-xs text-muted-foreground">Last checked {formatIstTime(lastChecked)}</span>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={toggleSound}
        aria-pressed={soundOn}
        data-sound-toggle
      >
        {soundOn || soundPending ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        {soundOn ? "Sound on" : soundPending ? "Sound on — tap to enable" : "Sound off"}
      </Button>
      <PushAlertsButton variant="board" />
    </>
  );

  const pollNote = (
    <p className="mt-2 text-xs text-muted-foreground">
      {pollKind
        ? "New orders appear automatically while this screen is open."
        : "Not checking for new orders automatically. Tap Refresh to update."}
    </p>
  );

  const emptyText =
    orders.length === 0
      ? source.kind === "menu"
        ? source.acceptMenuOrders
          ? "No online orders yet. Share your store link on WhatsApp to get the first one."
          : "No online orders. Turn on “Order from menu” in Settings → Online orders to start taking them."
        : effective === "OPEN"
          ? "No orders yet. Share your drop on WhatsApp to get the first one."
          : "No orders on this drop."
      : "Nothing here right now.";

  return (
    <div className="mx-auto max-w-3xl">
      {drop && effective ? (
        <DropHeader
          drop={drop}
          effective={effective}
          vendorName={vendorName}
          vendorSlug={vendorSlug}
          controls={controls}
          pollNote={pollNote}
        />
      ) : source.kind === "menu" ? (
        <MenuHeader
          acceptMenuOrders={source.acceptMenuOrders}
          fulfilmentMode={source.fulfilmentMode}
          vendorSlug={vendorSlug}
          controls={controls}
          pollNote={pollNote}
        />
      ) : null}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {announcement && (
        <p className="mb-3 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-semibold" aria-hidden>
          {announcement}
        </p>
      )}

      <section aria-labelledby="summary-h" className="mb-4">
        <h2 id="summary-h" className="sr-only">
          Summary
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <li className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="font-mono text-lg font-bold tabular-nums">{formatINR(summary.paidPaise)}</p>
          </li>
          <li className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">To collect</p>
            <p className="font-mono text-lg font-bold tabular-nums">{formatINR(summary.pendingPaise)}</p>
          </li>
          <li className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Live orders</p>
            <p className="font-mono text-lg font-bold tabular-nums">{summary.activeOrders}</p>
          </li>
          <li className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Payment to check</p>
            <p className="font-mono text-lg font-bold tabular-nums">
              {summary.counts.PAYMENT_SUBMITTED + summary.counts.AWAITING_PAYMENT}
            </p>
          </li>
        </ul>
        {toCook.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">To cook: </span>
            {toCook
              .map((p) => `${p.name} ${p.qtyOrdered}${p.maxQty !== null ? `/${p.maxQty}` : ""}`)
              .join(" · ")}
          </p>
        )}
        {isMenu && (
          <div className="mt-3 rounded-lg border bg-card p-3" aria-live="polite">
            <h3 className="text-sm font-semibold">To make</h3>
            {toMake.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nothing to make right now.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Items to make">
                {toMake.map((r) => (
                  <li
                    key={r.name}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-3 text-sm"
                  >
                    <span className="font-mono font-bold tabular-nums">{r.qty} ×</span>
                    <span>{r.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <nav aria-label="Filter orders" className="-mx-4 mb-4 overflow-x-auto px-4">
        <div role="tablist" className="flex gap-2">
          {BOARD_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              aria-controls="orders-list"
              onClick={() => changeFilter(f.id)}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent",
              )}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
        </div>
      </nav>

      <section id="orders-list" role="tabpanel" aria-label="Orders" aria-busy={refreshing}>
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            {selectableVisible.length > 1 && (
              <div className="mb-2 flex items-center">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-md pr-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
                  <span className="inline-flex min-h-11 min-w-11 items-center justify-center">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-5 w-5 cursor-pointer accent-primary"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={bulkPending !== null}
                    />
                  </span>
                  {allSelected ? "Unselect all" : "Select all"} ({selectableVisible.length})
                </label>
              </div>
            )}
            <ul className="flex flex-col gap-3">
              {visible.map((o) => (
                <li key={o.id}>
                  <OrderCard
                    order={o}
                    vendorName={vendorName}
                    frozen={frozen}
                    isNew={newIds.has(o.id)}
                    pendingAction={pending?.orderId === o.id ? pending.action : null}
                    onAction={runAction}
                    selectable={isBulkSelectable(o, frozen)}
                    selected={activeSelected.has(o.id)}
                    onToggleSelect={toggleSelect}
                    locked={bulkPending !== null}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        {activeSelected.size > 0 && (
          <BulkActionBar
            selectedCount={activeSelected.size}
            counts={bulkCounts}
            pending={bulkPending}
            targetsFor={targetsFor}
            onRun={(a) => void runBulk(a)}
            onClear={() => setSelected(EMPTY_SELECTION)}
          />
        )}
      </section>
    </div>
  );
}

function DropHeader({
  drop,
  effective,
  vendorName,
  vendorSlug,
  controls,
  pollNote,
}: {
  drop: BoardDrop;
  effective: EffectiveDropStatus;
  vendorName: string;
  vendorSlug: string;
  controls: ReactNode;
  pollNote: ReactNode;
}) {
  const closesAt = new Date(drop.closesAt);
  const fStart = new Date(drop.fulfilmentStartsAt);
  const fEnd = new Date(drop.fulfilmentEndsAt);

  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground">{drop.title}</h1>
          <p className="mt-1 text-sm">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                effective === "OPEN" ? "border-primary bg-primary/10" : "border-border bg-muted",
              )}
            >
              {DROP_STATUS_LABEL[effective]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/drops/${drop.id}/edit`} className={LINK_BTN}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </Link>
          <Link href={`/drops/${drop.id}/prep`} className={LINK_BTN}>
            <ChefHat className="h-4 w-4" aria-hidden />
            Prep sheet
          </Link>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-foreground">Orders close: </dt>
          <dd className="inline">
            {formatIstDate(closesAt)}, {formatIstTime(closesAt)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">
            {drop.fulfilmentMode === "PICKUP" ? "Pickup" : drop.fulfilmentMode === "DELIVERY" ? "Delivery" : "Delivery / pickup"}:{" "}
          </dt>
          <dd className="inline">
            {formatIstDate(fStart)}, {formatIstTime(fStart)} – {formatIstTime(fEnd)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {effective === "OPEN" && (
          <ShareDropButton
            dropId={drop.id}
            vendorName={vendorName}
            vendorSlug={vendorSlug}
            dropTitle={drop.title}
            closesAt={drop.closesAt}
            fulfilmentStartsAt={drop.fulfilmentStartsAt}
            fulfilmentEndsAt={drop.fulfilmentEndsAt}
            fulfilmentMode={drop.fulfilmentMode}
            itemNames={drop.items.map((i) => i.name)}
          />
        )}
        {controls}
      </div>
      {pollNote}
    </header>
  );
}

function MenuHeader({
  acceptMenuOrders,
  fulfilmentMode,
  vendorSlug,
  controls,
  pollNote,
}: {
  acceptMenuOrders: boolean;
  fulfilmentMode: FulfilmentMode;
  vendorSlug: string;
  controls: ReactNode;
  pollNote: ReactNode;
}) {
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground">Online orders</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                acceptMenuOrders ? "border-primary bg-primary/10" : "border-border bg-muted",
              )}
            >
              {acceptMenuOrders ? "Taking orders" : "Not taking orders"}
            </span>
            {acceptMenuOrders && <span className="text-muted-foreground">{MENU_MODE_LABEL[fulfilmentMode]}</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Orders customers placed from your menu in the last 3 days, plus older ones still open.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {acceptMenuOrders && (
            <a href={`/s/${vendorSlug}`} target="_blank" rel="noopener noreferrer" className={LINK_BTN}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              My store
            </a>
          )}
          <Link href="/settings/orders" className={LINK_BTN}>
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </Link>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">{controls}</div>
      {pollNote}
    </header>
  );
}
