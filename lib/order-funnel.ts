/**
 * The order leak map on /admin/metrics: where storefront buyers drop out
 * between opening a store and paying, split by where they came from. Pure and
 * client-safe; the database side is lib/order-funnel-server.ts and the view
 * counters are lib/store-views.ts. Definitions: docs/admin-redesign/PHASE-3.md.
 *
 * Stages, for the storefront orders PLACED in the window (a cohort, so every
 * later stage is a subset of the one before):
 *
 *   view → (cart: not tracked) → order placed → payment started → paid
 *
 * - **View**: a full load of /s/[slug], counted in Upstash (lib/store-views.ts).
 *   Not a cohort: views and orders are both counted by the day they happened.
 * - **Payment started**: Razorpay's window was opened (`razorpayOrderId`), the
 *   buyer said "I've paid" (`paymentClaimedAt`, or `paymentRejectedAt` once the
 *   seller answered "Not received"), the buyer chose pay on delivery, or it is
 *   paid. A buyer who opened a UPI app but never said so is invisible to us.
 * - **Paid**: `paymentStatus` PAID (or REFUNDED: it was paid), by now.
 *
 * Nothing here is invented: a stage we can't count says so instead of a number.
 */

export const FUNNEL_SOURCES = ["instagram", "whatsapp", "direct", "other"] as const;
export type FunnelSource = (typeof FUNNEL_SOURCES)[number];

export const SOURCE_LABEL: Record<FunnelSource, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  direct: "Direct",
  other: "Other",
};

/** `Transaction.orderChannel` (lib/order-channel.ts) → a leak-map column. Null is "direct or untagged". */
export function funnelSourceOf(orderChannel: string | null): FunnelSource {
  if (orderChannel === null) return "direct";
  if (orderChannel === "instagram" || orderChannel === "whatsapp") return orderChannel;
  return "other";
}

// ─── Which page loads count as a view ───────────────────────────────

/**
 * Link-preview fetchers (WhatsApp, Instagram and Facebook use `WhatsApp/…` and
 * `facebookexternalhit`), search crawlers, headless browsers (our own E2E) and
 * scripts. A buyer's phone browser matches none of these.
 */
const NOT_A_BUYER_UA =
  /bot\b|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp\/|Headless|Lighthouse|PageSpeed|Playwright|Puppeteer|curl\/|Wget|python-|node-fetch|axios\/|Go-http-client|okhttp/i;

type HeaderReader = { get(name: string): string | null };

/**
 * Whether a render of the store page is a buyer arriving. Only a full document
 * load counts: a client-side refresh or navigation is a buyer already on the
 * page, and a prefetch is nobody.
 *
 * Next.js strips its own `RSC` header before the page can read it, so the
 * browser's `Sec-Fetch-Mode` does the work: "navigate" for a page load, "cors"
 * for the fetch behind `router.refresh()`. Browsers too old to send it count.
 */
export function isCountableStoreView(headers: HeaderReader): boolean {
  const ua = headers.get("user-agent") ?? "";
  if (!ua || NOT_A_BUYER_UA.test(ua)) return false;
  const mode = headers.get("sec-fetch-mode");
  if (mode !== null && mode !== "navigate") return false;
  if (headers.get("rsc") !== null || headers.get("next-router-prefetch") !== null) return false;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`;
  return !/prefetch|prerender/i.test(purpose);
}

// ─── The funnel ─────────────────────────────────────────────────────

export type PaymentStage = "not_started" | "started" | "paid";

export type FunnelOrderInput = {
  id: string;
  vendorId: string;
  billNumber: string;
  totalPaise: number;
  createdAt: Date;
  orderChannel: string | null;
  paymentMethod: string;
  paymentStatus: string;
  /** Razorpay's window was opened at least once (`razorpayOrderId` is set). */
  razorpayStarted: boolean;
  paymentClaimedAt: Date | null;
  paymentRejectedAt: Date | null;
  fulfilmentStatus: string | null;
};

export function paymentStageOf(
  o: Pick<FunnelOrderInput, "paymentMethod" | "paymentStatus" | "razorpayStarted" | "paymentClaimedAt" | "paymentRejectedAt">,
): PaymentStage {
  if (o.paymentStatus === "PAID" || o.paymentStatus === "REFUNDED") return "paid";
  if (o.paymentMethod === "CASH") return "started";
  if (o.razorpayStarted || o.paymentClaimedAt || o.paymentRejectedAt) return "started";
  return "not_started";
}

export type StageCounts = { total: number; bySource: Record<FunnelSource, number> };

function emptyCounts(): StageCounts {
  return { total: 0, bySource: { instagram: 0, whatsapp: 0, direct: 0, other: 0 } };
}

function add(counts: StageCounts, source: FunnelSource, n = 1): void {
  counts.total += n;
  counts.bySource[source] += n;
}

/** What lib/store-views.ts read for the window; null when KV is unavailable. */
export type ViewsInput = {
  /** When the first view was ever counted; null if none yet. */
  since: Date | null;
  bySource: Record<FunnelSource, number>;
} | null;

export type ViewsStage =
  | { status: "unavailable" }
  | { status: "not_started" }
  /** Counting began inside the window: the number covers only part of it. */
  | { status: "partial"; since: Date; counts: StageCounts }
  | { status: "full"; since: Date; counts: StageCounts };

export type Leak = { from: string; to: string; lost: number; of: number };

export type StalledOrder = {
  id: string;
  vendorId: string;
  billNumber: string;
  totalPaise: number;
  createdAt: Date;
  source: FunnelSource;
  stage: Exclude<PaymentStage, "paid">;
  payOnDelivery: boolean;
  status: "open" | "cancelled" | "delivered";
};

export type OrderFunnel = {
  views: ViewsStage;
  placed: StageCounts;
  started: StageCounts;
  paid: StageCounts;
  /** The step that loses the most buyers, or null when nothing is lost. */
  biggestLeak: Leak | null;
  /** Every unpaid order of the window, newest first. */
  stalled: StalledOrder[];
};

function viewsStage(views: ViewsInput, windowStart: Date): ViewsStage {
  if (views === null) return { status: "unavailable" };
  if (views.since === null) return { status: "not_started" };
  const counts = emptyCounts();
  for (const s of FUNNEL_SOURCES) add(counts, s, views.bySource[s]);
  return views.since > windowStart
    ? { status: "partial", since: views.since, counts }
    : { status: "full", since: views.since, counts };
}

function statusOf(fulfilmentStatus: string | null): StalledOrder["status"] {
  if (fulfilmentStatus === "CANCELLED") return "cancelled";
  if (fulfilmentStatus === "DELIVERED") return "delivered";
  return "open";
}

export function buildOrderFunnel(input: {
  orders: readonly FunnelOrderInput[];
  views: ViewsInput;
  windowStart: Date;
}): OrderFunnel {
  const placed = emptyCounts();
  const started = emptyCounts();
  const paid = emptyCounts();
  const stalled: StalledOrder[] = [];

  for (const o of input.orders) {
    const source = funnelSourceOf(o.orderChannel);
    const stage = paymentStageOf(o);
    add(placed, source);
    if (stage !== "not_started") add(started, source);
    if (stage === "paid") {
      add(paid, source);
    } else {
      stalled.push({
        id: o.id,
        vendorId: o.vendorId,
        billNumber: o.billNumber,
        totalPaise: o.totalPaise,
        createdAt: o.createdAt,
        source,
        stage,
        payOnDelivery: o.paymentMethod === "CASH",
        status: statusOf(o.fulfilmentStatus),
      });
    }
  }
  stalled.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));

  const views = viewsStage(input.views, input.windowStart);
  const steps: Leak[] = [
    { from: "Order placed", to: "Payment started", lost: placed.total - started.total, of: placed.total },
    { from: "Payment started", to: "Paid", lost: started.total - paid.total, of: started.total },
  ];
  // Views and orders aren't one cohort, so view → order is a leak only over a fully counted window.
  if (views.status === "full" && views.counts.total >= placed.total) {
    steps.unshift({ from: "Store view", to: "Order placed", lost: views.counts.total - placed.total, of: views.counts.total });
  }
  const biggestLeak = steps.reduce<Leak | null>((best, s) => (s.lost > 0 && (!best || s.lost > best.lost) ? s : best), null);

  return { views, placed, started, paid, biggestLeak, stalled };
}

/** "40%" of `of`, or null when there is nothing to divide by. */
export function stepRate(count: number, of: number): string | null {
  if (of <= 0) return null;
  return `${Math.round((count / of) * 100)}%`;
}

// ─── Drill-down filter ──────────────────────────────────────────────

export const STALLED_FILTERS = ["not_started", "started"] as const;
export type StalledFilter = (typeof STALLED_FILTERS)[number];

export const STALLED_LABEL: Record<StalledFilter, string> = {
  not_started: "Didn't start paying",
  started: "Started, not paid",
};

export function parseStalledFilter(raw: string | string[] | undefined): StalledFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STALLED_FILTERS.find((f) => f === value) ?? null;
}
