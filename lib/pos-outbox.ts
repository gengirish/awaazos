/**
 * POS offline outbox (docs/PWA_OFFLINE_PLAN.md, Phase 2).
 *
 * Every counter sale is written here first, then POSTed. Online the POST
 * succeeds at once and the entry is removed, so there is one code path whether
 * or not the network is up. Offline (or on a 5xx / timeout) the entry stays and
 * is drained later by `syncOutbox()`.
 *
 * If the device write itself fails (IndexedDB blocked or its backing store
 * broken), the sale is POSTed directly with the same `clientRef`. Nothing holds
 * it then, so a post that doesn't get an answer is reported as `unsaved`, never
 * as queued: the caller keeps the cart and passes the same `clientRef` back in
 * on the next attempt, which cannot bill twice.
 *
 * Rules:
 *   - Sync is event-driven only (page load, `online`, tab visible, after a
 *     successful sale). Never add an interval: Neon must be able to sleep.
 *   - `clientRef` (uuid) is the durable dedupe key: the server answers a replay
 *     with the original bill (200). It doubles as the Idempotency-Key.
 *   - Each entry carries the `vendorId` it was rung up for and is only ever sent
 *     for that vendor (`?vendor=` + body `vendorId`, which the server checks).
 *   - Entries can hold customer PII. Never log entry bodies; `failCode` holds a
 *     server error code, nothing else. Entries are deleted as soon as they sync.
 *
 * Browser-only (IndexedDB). The pure helpers at the top are unit tested in node.
 */

import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

import { getIstTodayStart } from "@/lib/billing-period";

export type OutboxSaleBody = {
  items: { menuItemId?: string; name: string; priceInPaise: number; qty: number }[];
  subtotalPaise: number;
  /** Offer discount (lib/offers.ts). Absent on a bill without one. */
  discountPaise?: number;
  offerId?: string | null;
  offerName?: string | null;
  taxPaise: number;
  totalPaise: number;
  paymentMethod: "CASH" | "UPI";
  upiRef: string | null;
};

export type OutboxSale = {
  clientRef: string;
  vendorId: string;
  /** ISO time the sale was rung up on this device. */
  clientCreatedAt: string;
  /** Per-device, per-vendor counter shown as "Offline #N" until the sale syncs. */
  localNo: number;
  body: OutboxSaleBody;
  status: "pending" | "failed";
  /** Server error code for a rejected entry (never a message or body). */
  failCode?: string;
};

export type SyncedBill = { billNumber: string; totalPaise: number; paymentMethod: "CASH" | "UPI" };

export type PostOutcome =
  | { kind: "ok"; bill: SyncedBill }
  /** Network error, timeout, 5xx, 429, in-flight: keep and try again later. */
  | { kind: "retry" }
  /** Session expired: keep, ask the vendor to sign in. */
  | { kind: "auth" }
  /** The server will never accept this body as it stands. */
  | { kind: "rejected"; code: string; status: number };

/** Fired on `window` whenever this device's outbox changes or a sync finishes. */
export const OUTBOX_CHANGED_EVENT = "awaazos:pos-outbox-changed";

/** A live checkout waits this long before treating the sale as queued. */
export const LIVE_POST_TIMEOUT_MS = 8_000;

// ── Pure helpers ──────────────────────────────────────────────────────────

/** How a sync should treat an HTTP status from POST /api/transactions. */
export function classifyStatus(status: number): "ok" | "retry" | "auth" | "rejected" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  // 404 = the signed-in account can't reach this entry's vendor. Keep it for
  // when that vendor signs in again rather than throwing a real sale away.
  if (status === 404) return "auth";
  if (status === 408 || status === 409 || status === 429 || status >= 500) return "retry";
  return "rejected";
}

/** Paise still waiting to sync for sales rung up on the IST day of `now`. */
export function pendingTodayPaise(sales: OutboxSale[], now: Date = new Date()): number {
  const today = getIstTodayStart(now).getTime();
  let sum = 0;
  for (const s of sales) {
    if (s.status !== "pending") continue;
    if (getIstTodayStart(new Date(s.clientCreatedAt)).getTime() !== today) continue;
    sum += s.body.totalPaise;
  }
  return sum;
}

/** Oldest first, so bill numbers follow the order sales were rung up. */
export function syncOrder(sales: OutboxSale[]): OutboxSale[] {
  return [...sales]
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt) || a.localNo - b.localNo);
}

// A Map, not an object: a code like "toString" must not find a prototype member.
const SALE_REJECTED_MESSAGES = new Map<string, string>([
  ["monthly_txn_cap_reached", "Monthly bill limit reached for your plan"],
  ["billing_locked", "Your free trial has ended. Subscribe in Settings → Plan & billing to keep selling."],
  ["subtotal_mismatch", "This bill's total didn't add up. Close this, check the cart and try again."],
  ["total_mismatch", "This bill's total didn't add up. Close this, check the cart and try again."],
  ["discount_mismatch", "Your offers have changed. Reload this page, then ring up the order again."],
]);

/**
 * What the vendor is told when a live checkout is refused. Only known codes
 * get their own line: a server string is never shown as it came.
 */
export function saleRejectedMessage(code: string, status?: number): string {
  const known = SALE_REJECTED_MESSAGES.get(code);
  if (known) return known;
  if (status === 403) return "This account can't record sales for this store. Ask the owner to check your access.";
  return "Could not record payment";
}

/** What the vendor is told when a sale was neither committed nor saved on the device. */
export function saleUnsavedMessage(reason: "network" | "auth"): string {
  return reason === "auth"
    ? "Couldn't save this sale. Sign in again, then try again."
    : "Couldn't save this sale. Check your connection and try again.";
}

// ── IndexedDB ─────────────────────────────────────────────────────────────

let store: UseStore | null = null;
function db(): UseStore {
  store ??= createStore("awaazos-pos", "outbox");
  return store;
}

const saleKey = (vendorId: string, clientRef: string) => `sale:${vendorId}:${clientRef}`;
const seqKey = (vendorId: string) => `seq:${vendorId}`;

/** Last answer from the server per vendor: does the session need a fresh sign-in? */
const signInNeeded = new Map<string, boolean>();

export function needsSignIn(vendorId: string): boolean {
  return signInNeeded.get(vendorId) ?? false;
}

function announce(): void {
  try {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  } catch {
    // Non-browser: nothing is listening.
  }
}

export async function listSales(vendorId: string): Promise<OutboxSale[]> {
  const prefix = `sale:${vendorId}:`;
  const all = await entries<string, OutboxSale>(db());
  return all.filter(([k]) => typeof k === "string" && k.startsWith(prefix)).map(([, v]) => v);
}

async function nextLocalNo(vendorId: string): Promise<number> {
  const n = ((await get<number>(seqKey(vendorId), db())) ?? 0) + 1;
  await set(seqKey(vendorId), n, db());
  return n;
}

async function putSale(sale: OutboxSale): Promise<void> {
  await set(saleKey(sale.vendorId, sale.clientRef), sale, db());
}

/** Never rejects: an entry that can't be deleted is simply still listed. */
export async function removeSale(vendorId: string, clientRef: string): Promise<void> {
  try {
    await del(saleKey(vendorId, clientRef), db());
  } catch {
    // IndexedDB unavailable. If the entry did sync, the next drain replays its
    // clientRef, gets the original bill back and tries the delete again.
  }
  announce();
}

// ── Network ───────────────────────────────────────────────────────────────

async function postSale(sale: OutboxSale, opts: { deferred: boolean; timeoutMs?: number }): Promise<PostOutcome> {
  const controller = new AbortController();
  const timer = opts.timeoutMs ? window.setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  try {
    const res = await fetch(`/api/transactions?vendor=${encodeURIComponent(sale.vendorId)}`, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Idempotency-Key": sale.clientRef },
      body: JSON.stringify({
        ...sale.body,
        clientRef: sale.clientRef,
        clientCreatedAt: sale.clientCreatedAt,
        vendorId: sale.vendorId,
        deferred: opts.deferred,
      }),
    });
    const kind = classifyStatus(res.status);
    if (kind === "ok") {
      const data = (await res.json().catch(() => null)) as { transaction?: SyncedBill } | null;
      if (!data?.transaction?.billNumber) return { kind: "retry" };
      return {
        kind: "ok",
        bill: {
          billNumber: data.transaction.billNumber,
          totalPaise: data.transaction.totalPaise,
          paymentMethod: data.transaction.paymentMethod,
        },
      };
    }
    if (kind === "rejected") {
      const data = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
      return { kind, code: String(data?.code ?? data?.error ?? res.status).slice(0, 64), status: res.status };
    }
    return { kind };
  } catch {
    // Offline, DNS, abort/timeout: the request may or may not have committed;
    // clientRef makes the next attempt safe either way.
    return { kind: "retry" };
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

export type CheckoutResult =
  | { kind: "synced"; bill: SyncedBill }
  | { kind: "queued"; localNo: number; needsSignIn: boolean }
  | { kind: "rejected"; code: string; status: number }
  /**
   * The device could not store the sale and the server did not confirm it, so
   * nothing holds it. Retry with this `clientRef` to stay idempotent.
   */
  | { kind: "unsaved"; clientRef: string; reason: "network" | "auth" };

/**
 * Ring up a sale: save it on the device, then try to commit it right away.
 * Pass the `clientRef` of an earlier `unsaved` result to retry that sale.
 */
export async function checkoutSale(
  vendorId: string,
  body: OutboxSaleBody,
  opts: { clientRef?: string } = {},
): Promise<CheckoutResult> {
  const sale: OutboxSale = {
    clientRef: opts.clientRef ?? crypto.randomUUID(),
    vendorId,
    clientCreatedAt: new Date().toISOString(),
    localNo: 0,
    body,
    status: "pending",
  };
  let stored = false;
  try {
    sale.localNo = await nextLocalNo(vendorId);
    await putSale(sale);
    stored = true;
  } catch {
    // IndexedDB blocked or broken: go straight to the server instead.
  }
  if (stored) announce();

  const outcome: PostOutcome =
    typeof navigator !== "undefined" && navigator.onLine === false
      ? { kind: "retry" }
      : await postSale(sale, { deferred: false, timeoutMs: LIVE_POST_TIMEOUT_MS });

  if (outcome.kind !== "retry") signInNeeded.set(vendorId, outcome.kind === "auth");
  if (outcome.kind === "ok") {
    if (stored) await removeSale(vendorId, sale.clientRef);
    // The network is evidently up: push anything older that was waiting.
    void syncOutbox(vendorId);
    return { kind: "synced", bill: outcome.bill };
  }
  if (outcome.kind === "rejected") {
    // Live rejection (plan cap, tampered totals): same as before the outbox,
    // the vendor sees the error and the sale isn't kept.
    if (stored) await removeSale(vendorId, sale.clientRef);
    return { kind: "rejected", code: outcome.code, status: outcome.status };
  }
  if (!stored) {
    return { kind: "unsaved", clientRef: sale.clientRef, reason: outcome.kind === "auth" ? "auth" : "network" };
  }
  return { kind: "queued", localNo: sale.localNo, needsSignIn: outcome.kind === "auth" };
}

export type SyncSummary = { synced: number; remaining: number; needsSignIn: boolean };

const inFlight = new Map<string, Promise<SyncSummary>>();

/** Drain this vendor's pending sales, oldest first. Single-flight per vendor. */
export function syncOutbox(vendorId: string): Promise<SyncSummary> {
  const running = inFlight.get(vendorId);
  if (running) return running;
  const p = drain(vendorId).finally(() => {
    inFlight.delete(vendorId);
    announce();
  });
  inFlight.set(vendorId, p);
  return p;
}

async function drain(vendorId: string): Promise<SyncSummary> {
  let synced = 0;
  let needsSignIn = false;
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const pending = syncOrder(await listSales(vendorId));
      return { synced, remaining: pending.length, needsSignIn };
    }
    const queue = syncOrder(await listSales(vendorId));
    for (let i = 0; i < queue.length; i++) {
      const sale = queue[i]!;
      const outcome = await postSale(sale, { deferred: true, timeoutMs: 20_000 });
      if (outcome.kind !== "retry") signInNeeded.set(vendorId, outcome.kind === "auth");
      if (outcome.kind === "ok") {
        await del(saleKey(vendorId, sale.clientRef), db());
        synced++;
        continue;
      }
      if (outcome.kind === "rejected") {
        await putSale({ ...sale, status: "failed", failCode: outcome.code });
        continue;
      }
      // retry / auth: stop; the next trigger picks up from here.
      needsSignIn = outcome.kind === "auth";
      return { synced, remaining: queue.length - i, needsSignIn };
    }
    return { synced, remaining: 0, needsSignIn };
  } catch {
    // IndexedDB unavailable (private mode quirks): nothing to drain.
    return { synced, remaining: 0, needsSignIn };
  }
}
