"use client";

import type { FulfilmentMode, StaffRole } from "@prisma/client";
import {
  BellRing,
  ChefHat,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import type { StoryImage } from "@/components/drops/InstagramStoryButton";
import { BoardMoreActions, MORE_ACTION_ROW } from "@/components/drops/orders/BoardMoreActions";
import { BulkActionBar } from "@/components/drops/orders/BulkActionBar";
import { OrderCard, type OrderSource } from "@/components/drops/orders/OrderCard";
import { ShareDropButton } from "@/components/drops/ShareDropButton";
import { PushAlertsButton, PushAlertsPrompt } from "@/components/push/PushAlertsButton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { usePushAlerts } from "@/hooks/usePushAlerts";
import type { DeliveryRider } from "@/lib/delivery-riders";
import { formatINR } from "@/lib/currency";
import type { EffectiveDropStatus } from "@/lib/drops";
import {
  BOARD_FILTERS,
  DROP_STATUS_LABEL,
  boardPollKind,
  countByFilter,
  dropOrdersHref,
  filterByHandover,
  filterOrders,
  firstName,
  groupByFulfilment,
  groupIdsByDrop,
  isDropFrozen,
  liveEffectiveStatus,
  newOrderIds,
  orderActionBase,
  ordersInScope,
  prepFromOrders,
  searchOrders,
  summarizeOrders,
  type BoardFilter,
  type BoardOrder,
  type BoardScope,
  type HandoverFilter,
  type OrderAction,
} from "@/lib/drops-board";
import type { BoardDrop } from "@/lib/drops-board-server";
import { buildWhatsAppShareUrl } from "@/lib/drops-share";
import { formatIstDate, formatIstTime } from "@/lib/drops-time";
import { BOARD_POLL_MS, toMakeFromOrders } from "@/lib/menu-orders-board";
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
import {
  PUSH_ARRIVED_EVENT,
  readOrderSoundPref,
  speakNewOrder,
  writeOrderSoundPref,
  type PushArrivedDetail,
} from "@/lib/order-voice";
import { cn } from "@/lib/utils";

// The select primitives are heavy and only a vendor with two or more sources
// gets a picker, so it loads after the board. The placeholder holds its place.
const BoardScopePicker = dynamic(() => import("@/components/drops/orders/BoardScopePicker"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-11 w-40 rounded-md border border-input" />,
});
// Only sellers taking menu orders see the store's share controls; load them after the board.
const ShareStoreControls = dynamic(
  () => import("@/components/drops/ShareStoreControls").then((m) => m.ShareStoreControls),
  { loading: () => <div aria-hidden className="h-11 rounded-full border border-input" /> },
);

const MAX_TIMEOUT_MS = 2_147_483_647;
/** Coming back to the tab (e.g. tapping a push alert) refetches at most this often. */
const VISIBLE_REFETCH_MIN_MS = 30_000;

type Props = {
  vendorName: string;
  vendorSlug: string;
  /** "Order from menu" is switched on (Settings → Online orders). */
  acceptMenuOrders: boolean;
  menuFulfilmentMode: FulfilmentMode;
  initialOrders: BoardOrder[];
  initialDrops: BoardDrop[];
  /** From `?drop=`: open the board narrowed to this drop (ignored if it is not on the board). */
  initialDropId: string | null;
  initialSignal: number | null;
  /** The viewer's role here. Drops are MANAGER+, so a cashier is never sent to build one. */
  staffRole: StaffRole;
  /** Saved delivery riders (Settings → Online orders): "Send to <name>" on delivery orders. */
  riders?: DeliveryRider[];
};

type OrdersResponse = { data: BoardOrder[]; drops: BoardDrop[]; signal: number | null };
type BulkResponse = { data?: BulkOrderResult & { orders: BoardOrder[] }; error?: string };

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const NO_IDS: readonly string[] = [];

/** A handful of orders is read at a glance; the search box appears from here. */
const SEARCH_MIN_ORDERS = 6;

const HANDOVER_FILTERS: { id: HandoverFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pickup", label: "Pickup" },
  { id: "delivery", label: "Delivery" },
];

const ORDERS_URL = "/api/storefront-orders";
/** `story` key for the whole store's Instagram image (drops use their id). */
const STORE_STORY = "store";
const SIGNAL_URL = "/api/storefront-orders/signal";

const MENU_MODE_LABEL: Record<FulfilmentMode, string> = {
  PICKUP: "Pickup only",
  DELIVERY: "Delivery only",
  BOTH: "Delivery or pickup",
};

const ALL_BOARD_SCOPE =
  "Every online order, from your menu and from your drops: the last 3 days, plus older ones still open.";
const MENU_BOARD_SCOPE = "Orders customers placed from your menu in the last 3 days, plus older ones still open.";

const ACTION_DONE: Record<OrderAction, string> = {
  confirm: "Order confirmed",
  mark_paid: "Marked paid",
  reject_payment: "Marked not received",
  cancel: "Order cancelled",
  deliver: "Marked delivered",
  undeliver: "Moved back to confirmed",
};

const LINK_BTN =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** Summary tile: one line (label · figure) on phones, label over figure from sm. */
const KPI_TILE =
  "flex min-w-0 flex-wrap items-baseline justify-between gap-x-1.5 rounded-lg border bg-card px-2 py-1.5 sm:block sm:p-3";
const KPI_VALUE = "font-mono text-sm font-bold tabular-nums sm:text-lg";

const SEGMENT_BTN =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

const STATUS_BADGE = "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";

/** Header controls built by the board (they need its state), laid out by each header. */
type BoardTools = {
  refreshButton: ReactNode;
  lastChecked: ReactNode;
  soundButton: (className?: string) => ReactNode;
  pollNote: ReactNode;
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

export function OrdersBoard({
  vendorName,
  vendorSlug,
  acceptMenuOrders,
  menuFulfilmentMode,
  initialOrders,
  initialDrops,
  initialDropId,
  initialSignal,
  staffRole,
  riders = [],
}: Props) {
  const [orders, setOrders] = useState(initialOrders);
  const [drops, setDrops] = useState(initialDrops);
  const [scope, setScope] = useState<BoardScope>(initialDropId ?? "all");
  const [filter, setFilter] = useState<BoardFilter>("needs_action");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<{ orderId: string; action: OrderAction } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [bulkPending, setBulkPending] = useState<BulkOrderAction | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  // Orders that arrived and have not been looked at yet: the "N new orders —
  // show" button. Cleared when she taps it or acts on any order.
  const [unseenIds, setUnseenIds] = useState<readonly string[]>(NO_IDS);
  const [query, setQuery] = useState("");
  const [handover, setHandover] = useState<HandoverFilter>("all");
  const [soundOn, setSoundOn] = useState(false);
  /** Saved choice was "on" but audio is still locked until the first tap. */
  const [soundPending, setSoundPending] = useState(false);
  /** Last successful check for new orders (orders fetch or signal check). Set after mount. */
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  /** null = KV unavailable → fallback mode. */
  const [signalMode, setSignalMode] = useState<"kv" | "fallback">(initialSignal === null ? "fallback" : "kv");
  // Held here, not in the share button: on phones the button lives in the "More
  // actions" sheet, which unmounts on close. The Instagram flow is two taps
  // (fetch, then share), and the fetched image must outlive a closed sheet.
  // Keyed by drop id, or STORE_STORY for the whole store's image.
  const [story, setStory] = useState<{ key: string; image: StoryImage } | null>(null);

  const signalRef = useRef<number | null>(initialSignal);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const inFlight = useRef(false);
  const lastVisibleRefetch = useRef(0);
  // The drop the vendor last opened stays on the board across refetches, even
  // once it is old enough to have dropped off by itself (see loadOrdersBoard).
  const pinnedDropRef = useRef<string | null>(initialDropId);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<BoardFilter, HTMLButtonElement | null>>>({});
  // The shared phone-alerts store (hooks/usePushAlerts.ts): the opt-in copies on
  // this page already subscribe to it, so reading it here asks the browser nothing new.
  const push = usePushAlerts();

  // What the board can be narrowed to. With a single source there is nothing to
  // choose, so the board simply is that source (and shows its details).
  const showMenu = acceptMenuOrders || orders.some((o) => o.dropId === null);
  const sources = useMemo<BoardScope[]>(
    () => [...(showMenu ? ["menu"] : []), ...drops.map((d) => d.id)],
    [showMenu, drops],
  );
  const activeScope: BoardScope =
    sources.length === 1 ? sources[0]! : scope !== "all" && sources.includes(scope) ? scope : "all";
  const drop = drops.find((d) => d.id === activeScope) ?? null;
  const effective: EffectiveDropStatus | null = drop ? liveEffectiveStatus(drop, now) : null;

  const frozenDropIds = useMemo(
    () => new Set(drops.filter((d) => isDropFrozen(d.status)).map((d) => d.id)),
    [drops],
  );
  const isFrozen = useCallback(
    (o: { dropId: string | null }) => o.dropId !== null && frozenDropIds.has(o.dropId),
    [frozenDropIds],
  );

  const refresh = useCallback(async (opts?: { manual?: boolean; quiet?: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (opts?.manual) setRefreshing(true);
    try {
      const pin = pinnedDropRef.current;
      const res = await fetch(pin ? `${ORDERS_URL}?drop=${encodeURIComponent(pin)}` : ORDERS_URL, {
        cache: "no-store",
      });
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
        setUnseenIds((prev) => [...prev, ...fresh]);
        // Chime, then the spoken alert — unless the push already said it.
        if (soundRef.current && !opts?.quiet) {
          beep(audioRef.current);
          speakNewOrder(fresh.length === 1 ? newest?.customerName : null);
        }
      }
      signalRef.current = body.signal;
      setSignalMode(body.signal === null ? "fallback" : "kv");
      setOrders(body.data);
      setDrops(body.drops);
      setNow(new Date());
      setLastChecked(new Date());
    } catch {
      if (opts?.manual) toast.error("Could not refresh orders. Check your internet.");
    } finally {
      inFlight.current = false;
      if (opts?.manual) setRefreshing(false);
    }
  }, []);

  // Re-render exactly when a drop opens / closes, so polling starts / stops on
  // time without a network call. Pure client timer — touches nothing remote.
  const nextEdgeAt = useMemo(() => {
    const t = now.getTime();
    const edges = drops
      .flatMap((d) => [d.opensAt, d.closesAt])
      .filter((x): x is string => Boolean(x))
      .map((x) => new Date(x).getTime())
      .filter((ms) => ms > t);
    return edges.length > 0 ? Math.min(...edges) : null;
  }, [drops, now]);
  useEffect(() => {
    if (nextEdgeAt === null) return;
    const id = window.setTimeout(
      () => setNow(new Date()),
      Math.min(Math.max(nextEdgeAt - Date.now(), 0) + 500, MAX_TIMEOUT_MS),
    );
    return () => window.clearTimeout(id);
  }, [nextEdgeAt]);

  // New-order detection without pinning Neon awake. Instant alerts come from Web
  // Push (lib/push.ts); polling is only a fallback, so the board ticks every
  // 6 min — above Neon's 5-min idle timeout, since each tick's session check
  // reads Postgres.
  //  - KV available: read the Upstash counter, refetch only when it moves.
  //  - No KV: refetch directly, only while something is taking orders.
  //  - Only while the tab is visible; returning to the tab refetches once.
  //  - Nothing at all unless a buyer could order right now: "order from menu"
  //    is on, or a drop is open (or about to open). See `boardPollKind`.
  const pollKind = boardPollKind({
    acceptMenuOrders,
    dropStatuses: drops.map((d) => liveEffectiveStatus(d, now)),
    signalMode,
  });

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
        const res = await fetch(SIGNAL_URL, { cache: "no-store" });
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
  }, [pollKind, refresh]);

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

  // A push for this vendor reached the device (components/push/OrderVoiceAlerts.tsx):
  // show the order now instead of at the next poll. One read, only when
  // something actually happened.
  useEffect(() => {
    const onPush = (e: Event) => {
      const detail = (e as CustomEvent<PushArrivedDetail>).detail;
      if (!detail || detail.kind === "test") return;
      void refresh({ quiet: detail.announced });
    };
    window.addEventListener(PUSH_ARRIVED_EVENT, onPush);
    return () => window.removeEventListener(PUSH_ARRIVED_EVENT, onPush);
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
    if (readOrderSoundPref()) setSoundPending(true);
  }, []);

  useEffect(() => {
    if (!soundPending) return;
    const onTap = (e: Event) => {
      // The Sound button handles its own tap.
      if (e.target instanceof Element && e.target.closest("[data-sound-toggle]")) return;
      unlockAudio(false);
      // After the tap has been handled: a re-render in the middle of the click
      // makes React drop the change of a checkbox that was the thing tapped.
      setTimeout(() => {
        setSoundOn(true);
        setSoundPending(false);
      }, 0);
    };
    document.addEventListener("click", onTap, true);
    return () => document.removeEventListener("click", onTap, true);
  }, [soundPending, unlockAudio]);

  const toggleSound = () => {
    const turnOn = soundPending || !soundOn;
    if (turnOn) {
      unlockAudio(true);
      // Inside the tap: lets the vendor hear the alert, and unlocks speech on iOS.
      speakNewOrder();
    }
    setSoundPending(false);
    setSoundOn(turnOn);
    writeOrderSoundPref(turnOn);
  };

  const seenNewOrders = () => {
    setUnseenIds(NO_IDS);
    setAnnouncement("");
  };

  const runAction = async (orderId: string, action: OrderAction) => {
    const order = ordersRef.current.find((o) => o.id === orderId);
    if (!order) return;
    setPending({ orderId, action });
    try {
      const res = await fetch(`${orderActionBase(order.dropId)}/${encodeURIComponent(orderId)}`, {
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
        seenNewOrders();
        if (action === "deliver") {
          // A slip of the thumb at the door: one tap puts it back (the card's own
          // "Undo delivered" is a filter away by now).
          toast.success(updated.fulfilmentType === "PICKUP" ? "Marked picked up" : ACTION_DONE.deliver, {
            duration: 8000,
            classNames: { actionButton: "min-h-11" },
            action: { label: "Undo", onClick: () => void runAction(updated.id, "undeliver") },
          });
        } else {
          toast.success(ACTION_DONE[action]);
        }
        return;
      }
      if (body.error === "drop_frozen") {
        toast.error("Orders are locked. Only payment and delivery can change now.");
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

  const scoped = useMemo(() => ordersInScope(orders, activeScope), [orders, activeScope]);
  const summary = useMemo(() => summarizeOrders(scoped), [scoped]);
  const dropItems = drop?.items;
  const prep = useMemo(() => (dropItems ? prepFromOrders(dropItems, scoped) : []), [dropItems, scoped]);
  // "To make" is about today's menu orders. A drop is cooked on its own day and
  // has its own "To cook" line and prep sheet, so its dishes are never mixed in.
  const showToMake = !drop && showMenu;
  const toMake = useMemo(
    () => (showToMake ? toMakeFromOrders(ordersInScope(scoped, "menu")) : []),
    [showToMake, scoped],
  );
  const counts = useMemo(() => countByFilter(scoped), [scoped]);
  const inFilter = useMemo(() => filterOrders(scoped, filter), [scoped, filter]);
  // Handover day: the Confirmed list splits into what is collected and what goes out.
  const showHandover = useMemo(() => {
    if (filter !== "confirmed") return false;
    const { pickup, delivery } = groupByFulfilment(inFilter);
    return pickup.length > 0 && delivery.length > 0;
  }, [filter, inFilter]);
  const activeHandover: HandoverFilter = showHandover ? handover : "all";
  const trimmedQuery = query.trim();
  // Search is over the list already on the device: no request, no timer.
  const visible = useMemo(
    () => searchOrders(filterByHandover(inFilter, activeHandover), trimmedQuery),
    [inFilter, activeHandover, trimmedQuery],
  );
  const matchesInScope = useMemo(
    () => (trimmedQuery ? searchOrders(scoped, trimmedQuery).length : 0),
    [scoped, trimmedQuery],
  );
  const showSearch = scoped.length >= SEARCH_MIN_ORDERS || query !== "";
  const unseenCount = useMemo(() => {
    if (unseenIds.length === 0) return 0;
    const ids = new Set(unseenIds);
    return orders.filter((o) => ids.has(o.id)).length;
  }, [orders, unseenIds]);
  const toCook = prep.filter((p) => p.qtyOrdered > 0);

  // Selection is limited to what is on screen and still actionable: derived, so
  // a refetch that moves an order to another tab silently drops it.
  const activeSelected = useMemo(() => pruneSelection(selected, visible, isFrozen), [selected, visible, isFrozen]);
  const selectableVisible = useMemo(() => visible.filter((o) => isBulkSelectable(o, isFrozen(o))), [visible, isFrozen]);
  const bulkCounts = useMemo(() => bulkActionCounts(visible, activeSelected, isFrozen), [visible, activeSelected, isFrozen]);
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

  // Arrow keys move between the filter tabs (one tab stop for the whole row).
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = BOARD_FILTERS.findIndex((f) => f.id === filter);
    const last = BOARD_FILTERS.length - 1;
    const next =
      e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = BOARD_FILTERS[next]!.id;
    changeFilter(id);
    tabRefs.current[id]?.focus();
  };

  const changeScope = (next: BoardScope) => {
    const isDrop = next !== "all" && next !== "menu";
    if (isDrop) pinnedDropRef.current = next;
    setScope(next);
    setSelected(EMPTY_SELECTION);
    // Keep the address in step, so a reload or coming back from the prep sheet
    // lands on the same drop.
    window.history.replaceState(null, "", isDrop ? dropOrdersHref(next) : "/orders");
  };

  // "N new orders — show": whatever tab, search or drop she was looking at, land
  // on the new orders at the top of Needs action.
  const showNewOrders = () => {
    const inScope = new Set(scoped.map((o) => o.id));
    if (unseenIds.some((id) => !inScope.has(id))) changeScope("all");
    changeFilter("needs_action");
    setQuery("");
    seenNewOrders();
    rootRef.current?.scrollIntoView({ block: "start" });
    // The button she tapped is gone; keep focus on the list's own tab.
    tabRefs.current.needs_action?.focus({ preventScroll: true });
  };

  const shareStore = async () => {
    const url = `${window.location.origin}/s/${encodeURIComponent(vendorSlug)}`;
    const text = `Order from ${vendorName}: ${url}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: vendorName, text, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // she closed the share sheet
        // Share API present but refused: fall through to WhatsApp.
      }
    }
    window.open(buildWhatsAppShareUrl(text), "_blank", "noopener,noreferrer");
  };

  const targetsFor = (action: BulkOrderAction) => bulkTargets(visible, activeSelected, action, isFrozen);

  const runBulk = async (action: BulkOrderAction) => {
    const targets = targetsFor(action);
    if (targets.length === 0) return;
    setBulkPending(action);
    const result: BulkOrderResult = { succeeded: [], failed: [] };
    const changed: BoardOrder[] = [];
    let requestFailed = false;
    try {
      // A selection can span menu orders and several drops; each goes to its own
      // route. A route takes at most 50 ids, so a big batch goes in a few calls,
      // one after another.
      send: for (const group of groupIdsByDrop(targets)) {
        for (let i = 0; i < group.ids.length; i += BULK_ORDER_MAX) {
          const res = await fetch(`${orderActionBase(group.dropId)}/bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderIds: group.ids.slice(i, i + BULK_ORDER_MAX), action }),
          });
          const body = (await res.json().catch(() => ({}))) as BulkResponse;
          if (!res.ok || !body.data) {
            requestFailed = true;
            break send;
          }
          result.succeeded.push(...body.data.succeeded);
          result.failed.push(...body.data.failed);
          changed.push(...body.data.orders);
        }
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
      seenNewOrders();
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

  const tools: BoardTools = {
    refreshButton: (
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
    ),
    lastChecked: lastChecked ? (
      <span className="min-w-0 text-xs leading-tight text-muted-foreground">Last checked {formatIstTime(lastChecked)}</span>
    ) : null,
    // Rendered twice (header from md, "More actions" sheet on phones). Both carry
    // data-sound-toggle so the "first tap enables sound" listener leaves them alone.
    soundButton: (className) => (
      <Button
        type="button"
        variant="outline"
        className={cn("min-h-11", className)}
        onClick={toggleSound}
        aria-pressed={soundOn}
        data-sound-toggle
      >
        {soundOn || soundPending ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        {soundOn ? "Sound on" : soundPending ? "Sound on — tap to enable" : "Sound off"}
      </Button>
    ),
    pollNote: (
      <p className="mt-2 text-xs text-muted-foreground">
        {!pollKind
          ? "Not checking for new orders automatically. Tap Refresh to update."
          : push.view === "subscribed"
            ? "New orders appear automatically while this screen is open."
            : push.view === "default" || push.view === "denied" || push.view === "ios-needs-install"
              ? "Checks every few minutes. Turn on phone alerts to see orders instantly."
              : "Checks every few minutes. Tap Refresh to check now."}
      </p>
    ),
  };

  const dropTitles = useMemo(() => new Map(drops.map((d) => [d.id, d.title])), [drops]);
  // Only worth saying where an order came from while the list mixes sources.
  const sourceOf = (o: BoardOrder): OrderSource | undefined =>
    activeScope !== "all"
      ? undefined
      : o.dropId === null
        ? { kind: "menu", label: "Menu order" }
        : { kind: "drop", label: dropTitles.get(o.dropId) ?? "Drop" };

  const storeIsLive = acceptMenuOrders || drops.some((d) => liveEffectiveStatus(d, now) === "OPEN");

  // Rendered up to three times (header from md, the phone share sheet and "More
  // actions" sheet, the empty state on phones); the story image lives up here.
  const share =
    drop && effective === "OPEN" ? (
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
        story={story?.key === drop.id ? story.image : null}
        onStory={(image) => setStory({ key: drop.id, image })}
      />
    ) : !drop && acceptMenuOrders ? (
      // Sellers who take orders from their everyday menu share the store itself.
      <ShareStoreControls
        vendorName={vendorName}
        vendorSlug={vendorSlug}
        story={story?.key === STORE_STORY ? story.image : null}
        onStory={(image) => setStory({ key: STORE_STORY, image })}
      />
    ) : null;

  const canEditDrops = staffRole !== "CASHIER";
  const newDropAction = canEditDrops ? (
    <Button asChild>
      <Link href="/drops/new">
        <Plus aria-hidden />
        New drop
      </Link>
    </Button>
  ) : undefined;
  const showAllAction = (
    <Button type="button" variant="outline" onClick={() => changeFilter("all")}>
      Show all orders
    </Button>
  );

  // Every empty list says what would fill it and offers the one next step.
  let empty: { title?: string; description: string; action?: ReactNode; live?: boolean };
  if (trimmedQuery && scoped.length > 0) {
    const elsewhere = filter !== "all" || activeHandover !== "all" ? matchesInScope : 0;
    empty = {
      title: `No orders match “${trimmedQuery}”`,
      description:
        elsewhere > 0
          ? `Not in this list, but ${elsewhere === 1 ? "1 order matches" : `${elsewhere} orders match`} in All.`
          : "Try a name, a bill number or the last 4 digits of a phone number.",
      action:
        elsewhere > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setHandover("all");
              changeFilter("all");
            }}
          >
            Show in all orders
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => setQuery("")}>
            <X aria-hidden />
            Clear search
          </Button>
        ),
      live: true,
    };
  } else if (scoped.length > 0) {
    empty =
      filter === "needs_action"
        ? {
            title: "All caught up",
            description: "No order needs you right now.",
            action:
              counts.confirmed > 0 ? (
                <Button type="button" variant="outline" onClick={() => changeFilter("confirmed")}>
                  Show confirmed ({counts.confirmed})
                </Button>
              ) : (
                showAllAction
              ),
          }
        : { description: "Nothing here right now.", action: showAllAction };
  } else if (drop) {
    empty =
      effective === "OPEN"
        ? {
            title: "No orders yet",
            description: "Share your drop on WhatsApp to get the first one.",
            // From md the same control sits in the header, just above.
            action: <div className="w-full max-w-sm md:hidden">{share}</div>,
          }
        : effective === "DRAFT" && canEditDrops
          ? {
              title: "No orders yet",
              description: "This drop is still a draft. Open it to start taking orders.",
              action: (
                <Button asChild>
                  <Link href={`/drops/${drop.id}/edit`}>
                    <Pencil aria-hidden />
                    Edit drop
                  </Link>
                </Button>
              ),
            }
          : { description: "No orders on this drop.", action: newDropAction };
  } else if (sources.length === 0) {
    empty = {
      title: "No orders yet",
      description: "Turn on “Order from menu” in Settings → Online orders, or create a drop, to start taking them.",
      action: newDropAction,
    };
  } else if (activeScope === "menu" && !acceptMenuOrders) {
    empty = {
      title: "No menu orders",
      description: "Turn on “Order from menu” in Settings → Online orders to start taking them.",
      action: (
        <Button asChild>
          <Link href="/settings/orders">
            <Settings aria-hidden />
            Online order settings
          </Link>
        </Button>
      ),
    };
  } else if (storeIsLive) {
    empty = {
      title: "No orders yet",
      description: "Share your store link on WhatsApp to get the first one.",
      action: (
        <Button type="button" onClick={() => void shareStore()}>
          <Share2 aria-hidden />
          Share store link
        </Button>
      ),
    };
  } else {
    empty = {
      title: "No orders yet",
      description: "None of your drops is taking orders right now.",
      action: newDropAction,
    };
  }

  return (
    <div ref={rootRef} className="mx-auto max-w-3xl scroll-mt-4">
      <BoardHeader
        scope={activeScope}
        sources={sources}
        drops={drops}
        drop={drop}
        effective={effective}
        acceptMenuOrders={acceptMenuOrders}
        menuFulfilmentMode={menuFulfilmentMode}
        storeIsLive={storeIsLive}
        vendorName={vendorName}
        vendorSlug={vendorSlug}
        tools={tools}
        share={share}
        onScope={changeScope}
      />

      {/* Phones, until this device has alerts on: the opt-in must not hide in the sheet. */}
      <PushAlertsPrompt className="mb-3" />

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <section aria-labelledby="summary-h" className="mb-3 sm:mb-4">
        <h2 id="summary-h" className="sr-only">
          Summary
        </h2>
        {/* Phones: label and figure share a line, so the 2×2 block is about half as tall. */}
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
          <li className={KPI_TILE}>
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className={KPI_VALUE}>{formatINR(summary.paidPaise)}</p>
          </li>
          <li className={KPI_TILE}>
            <p className="text-xs text-muted-foreground">To collect</p>
            <p className={KPI_VALUE}>{formatINR(summary.pendingPaise)}</p>
          </li>
          <li className={KPI_TILE}>
            <p className="text-xs text-muted-foreground">Live orders</p>
            <p className={KPI_VALUE}>{summary.activeOrders}</p>
          </li>
          <li className={KPI_TILE}>
            <p className="text-xs text-muted-foreground">Payment to check</p>
            {/* Only a buyer's "I've paid" claim is something to check; unpaid UPI orders just wait. */}
            <p className={KPI_VALUE}>{summary.counts.PAYMENT_SUBMITTED}</p>
            {summary.counts.AWAITING_PAYMENT > 0 && (
              <p className="basis-full text-xs text-muted-foreground">
                Awaiting payment: <span className="font-mono tabular-nums">{summary.counts.AWAITING_PAYMENT}</span>
              </p>
            )}
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
        {showToMake && (
          // Phones: heading and chips share a row, no card. From sm: the card as before.
          <div
            className="mt-2 flex items-start gap-2 sm:mt-3 sm:block sm:rounded-lg sm:border sm:bg-card sm:p-3"
            aria-live="polite"
          >
            <h3 className="shrink-0 text-sm font-semibold leading-7 sm:leading-normal">
              {activeScope === "all" ? "To make (menu)" : "To make"}
            </h3>
            {toMake.length === 0 ? (
              <p className="text-sm leading-7 text-muted-foreground sm:mt-1 sm:leading-normal">Nothing to make right now.</p>
            ) : (
              <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5 sm:mt-2 sm:gap-2" aria-label="Items to make">
                {toMake.map((r) => (
                  <li
                    key={r.name}
                    className="inline-flex min-h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-sm sm:min-h-9 sm:px-3"
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

      {/*
        Sticks to the top of the screen while the list scrolls. Phones: five
        segments that all fit at 360px (label over count), so no tab is cut off.
        From md: the pill row as before. aria-label keeps each tab's name
        "Label (count)" in both layouts. One tab stop; arrow keys, Home and End
        move between tabs. The "new orders" button rides along, so an order that
        lands while she is deep in another list is one tap away.
      */}
      <nav
        aria-label="Filter orders"
        className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 mb-3 border-b bg-background px-4 py-2 md:mb-4 md:overflow-x-auto md:border-b-0"
      >
        {unseenCount > 0 && (
          <button
            type="button"
            onClick={showNewOrders}
            className="mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-primary bg-primary/10 px-3 text-sm font-semibold hover:bg-primary/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BellRing className="h-4 w-4 shrink-0" aria-hidden />
            {unseenCount === 1 ? "1 new order" : `${unseenCount} new orders`} — show
          </button>
        )}
        <div
          role="tablist"
          aria-label="Order status"
          onKeyDown={onTabKeyDown}
          className="grid grid-cols-[repeat(4,minmax(0,1fr))_2.75rem] gap-0.5 md:flex md:gap-2"
        >
          {BOARD_FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                ref={(el) => {
                  tabRefs.current[f.id] = el;
                }}
                id={`orders-tab-${f.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="orders-list"
                aria-label={`${f.label} (${counts[f.id]})`}
                tabIndex={active ? 0 : -1}
                onClick={() => changeFilter(f.id)}
                className={cn(
                  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border py-1 text-center text-xs font-medium leading-tight focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  "md:min-h-11 md:shrink-0 md:flex-row md:gap-1 md:whitespace-nowrap md:rounded-full md:px-4 md:py-0 md:text-sm",
                  active
                    ? "border-primary bg-primary text-primary-foreground max-md:font-semibold max-md:underline max-md:underline-offset-2"
                    : "border-input bg-background hover:bg-accent",
                )}
              >
                <span className="max-w-full break-words">{f.label}</span>
                <span className="font-mono text-sm font-bold tabular-nums md:hidden">{counts[f.id]}</span>
                <span className="hidden md:inline">({counts[f.id]})</span>
              </button>
            );
          })}
        </div>
      </nav>

      <section id="orders-list" role="tabpanel" aria-labelledby={`orders-tab-${filter}`} aria-busy={refreshing}>
        {showSearch && (
          <div className="mb-3">
            <label htmlFor="orders-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              Search orders
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="orders-search"
                type="text"
                role="searchbox"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(EMPTY_SELECTION);
                }}
                placeholder="Name, bill number or last 4 of phone"
                className="pl-9 pr-12"
              />
              {query !== "" && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute right-0 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}
        {showHandover && (
          <div role="group" aria-label="Pickup or delivery" className="mb-3 grid grid-cols-3 gap-1">
            {HANDOVER_FILTERS.map((h) => {
              const on = handover === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setHandover(h.id);
                    setSelected(EMPTY_SELECTION);
                  }}
                  className={cn(
                    SEGMENT_BTN,
                    on
                      ? "border-primary bg-primary/10 font-semibold underline underline-offset-2"
                      : "border-input bg-background hover:bg-accent",
                  )}
                >
                  {h.label}
                  <span className="font-mono tabular-nums">({filterByHandover(inFilter, h.id).length})</span>
                </button>
              );
            })}
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState
            title={empty.title}
            description={empty.description}
            action={empty.action}
            role={empty.live ? "status" : undefined}
          />
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
                    riders={riders}
                    frozen={isFrozen(o)}
                    source={sourceOf(o)}
                    isNew={newIds.has(o.id)}
                    pendingAction={pending?.orderId === o.id ? pending.action : null}
                    onAction={runAction}
                    selectable={isBulkSelectable(o, isFrozen(o))}
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

/**
 * The board's one header: the title, the "Show" picker (only when there is
 * more than one source to pick from), the details of whatever is showing, and
 * the action row. The links beside the details and the rows of the phone "More
 * actions" sheet follow the scope: a drop offers Edit, Prep sheet and sharing;
 * everything else offers the store and the order settings.
 */
function BoardHeader({
  scope,
  sources,
  drops,
  drop,
  effective,
  acceptMenuOrders,
  menuFulfilmentMode,
  storeIsLive,
  vendorName,
  vendorSlug,
  tools,
  share,
  onScope,
}: {
  scope: BoardScope;
  sources: BoardScope[];
  drops: BoardDrop[];
  drop: BoardDrop | null;
  effective: EffectiveDropStatus | null;
  acceptMenuOrders: boolean;
  menuFulfilmentMode: FulfilmentMode;
  storeIsLive: boolean;
  vendorName: string;
  vendorSlug: string;
  tools: BoardTools;
  /**
   * The drop's share control while it is taking orders; without a drop, the
   * store's while menu orders are on; else null. Built by the board.
   */
  share: ReactNode;
  onScope: (scope: BoardScope) => void;
}) {
  const hasPicker = sources.length > 1;
  const storeHref = `/s/${vendorSlug}`;

  let details: ReactNode;
  let links: ReactNode;
  let sheetDescription: string;
  let sheetRows: (close: () => void) => ReactNode;

  if (drop && effective) {
    const closesAt = new Date(drop.closesAt);
    const fStart = new Date(drop.fulfilmentStartsAt);
    const fEnd = new Date(drop.fulfilmentEndsAt);
    const editHref = `/drops/${drop.id}/edit`;
    const prepHref = `/drops/${drop.id}/prep`;

    details = (
      <>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* The picker already names the drop; without one, say it here. */}
          {!hasPicker && <h2 className="min-w-0 break-words text-base font-semibold text-foreground">{drop.title}</h2>}
          <span
            className={cn(STATUS_BADGE, effective === "OPEN" ? "border-primary bg-primary/10" : "border-border bg-muted")}
          >
            {DROP_STATUS_LABEL[effective]}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-2">
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
      </>
    );
    links = (
      <>
        <Link href={editHref} className={LINK_BTN}>
          <Pencil className="h-4 w-4" aria-hidden />
          Edit
        </Link>
        <Link href={prepHref} className={LINK_BTN}>
          <ChefHat className="h-4 w-4" aria-hidden />
          Prep sheet
        </Link>
      </>
    );
    sheetDescription = "Edit, share and alert settings for this drop.";
    sheetRows = () => (
      <>
        <Link href={editHref} className={MORE_ACTION_ROW}>
          <Pencil className="h-4 w-4 shrink-0" aria-hidden />
          Edit
        </Link>
        <Link href={prepHref} className={MORE_ACTION_ROW}>
          <ChefHat className="h-4 w-4 shrink-0" aria-hidden />
          Prep sheet
        </Link>
        {share ? (
          <div className="rounded-md border border-input p-3">
            <h3 className="mb-2 text-sm font-semibold">Share this drop</h3>
            {share}
          </div>
        ) : null}
      </>
    );
  } else {
    const isMenu = scope === "menu";
    const scopeNote = isMenu ? MENU_BOARD_SCOPE : ALL_BOARD_SCOPE;

    details = (
      <>
        {isMenu && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(STATUS_BADGE, acceptMenuOrders ? "border-primary bg-primary/10" : "border-border bg-muted")}
            >
              {acceptMenuOrders ? "Taking orders" : "Not taking orders"}
            </span>
            {acceptMenuOrders && (
              <span className="text-sm text-muted-foreground">{MENU_MODE_LABEL[menuFulfilmentMode]}</span>
            )}
          </div>
        )}
        {/* Phones read this in the "More actions" sheet instead. */}
        <p className={cn("hidden text-xs text-muted-foreground md:block", isMenu && "mt-1")}>{scopeNote}</p>
      </>
    );
    links = (
      <>
        {storeIsLive && (
          <a href={storeHref} target="_blank" rel="noopener noreferrer" className={LINK_BTN}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            My store
          </a>
        )}
        <Link href="/settings/orders" className={LINK_BTN}>
          <Settings className="h-4 w-4" aria-hidden />
          Settings
        </Link>
      </>
    );
    sheetDescription = scopeNote;
    sheetRows = (close) => (
      <>
        {storeIsLive && (
          <a href={storeHref} target="_blank" rel="noopener noreferrer" className={MORE_ACTION_ROW} onClick={close}>
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            My store
          </a>
        )}
        <Link href="/settings/orders" className={MORE_ACTION_ROW}>
          <Settings className="h-4 w-4 shrink-0" aria-hidden />
          Settings
        </Link>
        {share ? (
          <div className="rounded-md border border-input p-3">
            <h3 className="mb-2 text-sm font-semibold">Share your store</h3>
            {share}
          </div>
        ) : null}
      </>
    );
  }

  // On a phone the "all orders" view has no details to show; skip the empty row.
  const detailsOnPhone = Boolean(drop) || scope === "menu";

  return (
    <header className="mb-3 md:mb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="font-display text-xl font-bold text-foreground md:text-2xl">Orders</h1>
        {hasPicker && (
          <BoardScopePicker scope={scope} showMenu={sources.includes("menu")} drops={drops} onScope={onScope} />
        )}
      </div>
      <div
        className={cn(
          "mt-2 flex-wrap items-start justify-between gap-3 md:mt-3 md:flex",
          detailsOnPhone ? "flex" : "hidden",
        )}
      >
        <div className="min-w-0 max-md:flex-1 max-md:basis-0">{details}</div>
        <div className="hidden flex-wrap gap-2 md:flex">{links}</div>
        {/* Phones: sharing an open drop is the way to get orders, so it does not hide in "More". */}
        {share ? <ShareSheetButton what={drop ? "drop" : "store"}>{share}</ShareSheetButton> : null}
      </div>
      <ActionRow tools={tools} lead={share} sheetDescription={sheetDescription} sheetRows={sheetRows} />
      {tools.pollNote}
    </header>
  );
}

/**
 * Refresh and "last checked" at every width. From md the other controls sit
 * beside them, as before. On phones they move into the "More actions" sheet,
 * so one row of controls is all that stands between the title and the orders.
 */
function ActionRow({
  tools,
  lead,
  sheetDescription,
  sheetRows,
}: {
  tools: BoardTools;
  /** Shown before Refresh, from md only. Phones get it through `sheetRows`. */
  lead?: ReactNode;
  sheetDescription: string;
  /** Rows only the sheet shows (the header shows them elsewhere from md). */
  sheetRows: (close: () => void) => ReactNode;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 md:mt-3 md:flex-wrap">
      {lead ? <div className="hidden md:block">{lead}</div> : null}
      {tools.refreshButton}
      {tools.lastChecked}
      {tools.soundButton("hidden md:inline-flex")}
      <div className="hidden md:contents">
        <PushAlertsButton variant="board" />
      </div>
      <BoardMoreActions description={sheetDescription}>
        {(close) => (
          <>
            {sheetRows(close)}
            {tools.soundButton("min-h-12 w-full justify-start gap-3")}
            <div className="flex flex-wrap items-center gap-2">
              <PushAlertsButton variant="board" />
            </div>
          </>
        )}
      </BoardMoreActions>
    </div>
  );
}

/** Phones only: the share control one tap from the header (from md it sits in the action row). */
function ShareSheetButton({ what, children }: { what: "drop" | "store"; children: ReactNode }) {
  const title = what === "drop" ? "Share this drop" : "Share your store";
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant="outline" className="shrink-0 md:hidden" aria-label={title}>
          <Share2 aria-hidden />
          Share
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Send it to your customers to get orders.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>{children}</ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
