"use client";

import { ChefHat, Loader2, Pencil, RefreshCw, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { OrderCard } from "@/components/drops/orders/OrderCard";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/currency";
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
import { cn } from "@/lib/utils";

/** Signal poll — Upstash only (plus the session check), cheap. */
const SIGNAL_POLL_MS = 20_000;
/** No KV: refetch orders directly, but slowly and only while OPEN + visible. */
const FALLBACK_POLL_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

type Props = {
  vendorName: string;
  vendorSlug: string;
  initialDrop: BoardDrop;
  initialOrders: BoardOrder[];
  initialSignal: number | null;
};

type OrdersResponse = { data: BoardOrder[]; drop: BoardDrop; signal: number | null };

const ACTION_DONE: Record<OrderAction, string> = {
  confirm: "Order confirmed",
  mark_paid: "Marked paid",
  cancel: "Order cancelled",
  deliver: "Marked delivered",
  undeliver: "Moved back to confirmed",
};

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

export function OrdersBoard({ vendorName, vendorSlug, initialDrop, initialOrders, initialSignal }: Props) {
  const [drop, setDrop] = useState(initialDrop);
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<BoardFilter>("needs_action");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<{ orderId: string; action: OrderAction } | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const [soundOn, setSoundOn] = useState(false);
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

  const effective = liveEffectiveStatus(drop, now);
  const frozen = drop.status === "FROZEN" || drop.status === "FULFILLED";

  const refresh = useCallback(async (opts?: { manual?: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (opts?.manual) setRefreshing(true);
    try {
      const res = await fetch(`/api/drops/${encodeURIComponent(initialDrop.id)}/orders`, { cache: "no-store" });
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
      setDrop(body.drop);
      setNow(new Date());
    } catch {
      if (opts?.manual) toast.error("Could not refresh orders. Check your internet.");
    } finally {
      inFlight.current = false;
      if (opts?.manual) setRefreshing(false);
    }
  }, [initialDrop.id]);

  // Re-render exactly when the drop opens / closes, so polling starts / stops on
  // time without a network call. Pure client timer — touches nothing remote.
  useEffect(() => {
    const t = Date.now();
    const edges = [drop.opensAt, drop.closesAt]
      .filter((x): x is string => Boolean(x))
      .map((x) => new Date(x).getTime() - t)
      .filter((ms) => ms > 0);
    if (edges.length === 0) return;
    const id = window.setTimeout(() => setNow(new Date()), Math.min(Math.min(...edges) + 500, MAX_TIMEOUT_MS));
    return () => window.clearTimeout(id);
  }, [drop.opensAt, drop.closesAt, now]);

  // New-order detection without pinning Neon awake:
  //  - KV available: poll the Upstash counter every 20s, refetch only when it moves.
  //  - No KV: refetch every 60s, only while OPEN.
  //  - Only while the tab is visible; nothing at all once orders are closed.
  const pollKind: "signal" | "fallback" | null = !shouldPollForOrders(effective)
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
        const res = await fetch(`/api/drops/${encodeURIComponent(initialDrop.id)}/signal`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { signal } = (await res.json()) as { signal: number | null };
        if (signal === null) {
          setSignalMode("fallback");
          return;
        }
        if (signal !== signalRef.current) await refresh();
      } catch {
        // Offline for a moment; next tick retries.
      }
    };

    const id = window.setInterval(tick, pollKind === "signal" ? SIGNAL_POLL_MS : FALLBACK_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollKind, initialDrop.id, refresh]);

  const toggleSound = () => {
    if (!soundOn) {
      // Created inside a tap, so mobile browsers allow it to play later.
      try {
        if (!audioRef.current) {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          audioRef.current = Ctor ? new Ctor() : null;
        }
        void audioRef.current?.resume();
        beep(audioRef.current);
      } catch {
        audioRef.current = null;
      }
    }
    setSoundOn((s) => !s);
  };

  const runAction = async (orderId: string, action: OrderAction) => {
    setPending({ orderId, action });
    try {
      const res = await fetch(
        `/api/drops/${encodeURIComponent(initialDrop.id)}/orders/${encodeURIComponent(orderId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
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
  const prep = useMemo(() => prepFromOrders(drop.items, orders), [drop.items, orders]);
  const counts = useMemo(() => countByFilter(orders), [orders]);
  const visible = useMemo(() => filterOrders(orders, filter), [orders, filter]);
  const toCook = prep.filter((p) => p.qtyOrdered > 0);

  const closesAt = new Date(drop.closesAt);
  const fStart = new Date(drop.fulfilmentStartsAt);
  const fEnd = new Date(drop.fulfilmentEndsAt);
  const linkBtn =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="mx-auto max-w-3xl">
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
            <Link href={`/drops/${drop.id}/edit`} className={linkBtn}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Link>
            <Link href={`/drops/${drop.id}/prep`} className={linkBtn}>
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
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={toggleSound}
            aria-pressed={soundOn}
          >
            {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {pollKind
            ? "New orders appear automatically while this screen is open."
            : "Not checking for new orders automatically. Tap Refresh to update."}
        </p>
      </header>

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
              onClick={() => setFilter(f.id)}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {orders.length === 0
              ? effective === "OPEN"
                ? "No orders yet. Share your drop on WhatsApp to get the first one."
                : "No orders on this drop."
              : "Nothing here right now."}
          </p>
        ) : (
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
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
