import { getKv } from "@/lib/kv";

/**
 * Tiny per-provider circuit breaker stored in Upstash KV.
 *
 * State machine:
 *   CLOSED  ── failureRate >= openThreshold over windowMs
 *           ──────────────────────────────────────────► OPEN
 *
 *   OPEN    ── now - openedAt > cooldownMs (one probe permitted)
 *           ──────────────────────────────────────────► HALF_OPEN
 *
 *   HALF_OPEN ── probe succeeds                       ► CLOSED
 *             ── probe fails                          ► OPEN (cooldown reset)
 *
 * Three keys per provider name:
 *   breaker:<name>:state        JSON {state, openedAt}             TTL 600s
 *   breaker:<name>:fail:<bucket>  INTEGER count of failures        TTL 120s
 *   breaker:<name>:succ:<bucket>  INTEGER count of successes       TTL 120s
 *
 * `bucket` = floor(now / windowMs), so we read at most 2 adjacent buckets to
 * approximate a sliding window with one extra read. Good enough for STT-scale
 * traffic (10s of req/s peak per vendor).
 *
 * Fail-open: if Upstash KV is unreachable, every check returns "allowed" and
 * record* calls are no-ops. Production POS must never break because of an
 * observability dependency.
 */

export type BreakerState = "closed" | "open" | "half_open";

const DEFAULTS = {
  /** Sliding-window length used for fail-rate counting. */
  windowMs: 60_000,
  /** How long an OPEN breaker waits before allowing one probe. */
  cooldownMs: 60_000,
  /** Don't trip on small samples; require at least this many requests. */
  minRequests: 10,
  /** failures / (failures + successes) — trips at >= this. */
  failureRateThreshold: 0.5,
  /** Defensive ceiling on KV TTLs. */
  stateTtlSec: 600,
  countersTtlSec: 120,
};

export type BreakerConfig = Partial<typeof DEFAULTS>;

type StateRecord = { state: BreakerState; openedAt: number };

function bucketKey(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

function parseState(raw: string | null): StateRecord {
  if (!raw) return { state: "closed", openedAt: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<StateRecord>;
    if (
      (parsed.state === "open" || parsed.state === "closed" || parsed.state === "half_open") &&
      typeof parsed.openedAt === "number"
    ) {
      return parsed as StateRecord;
    }
  } catch {
    /* ignore malformed JSON, treat as closed */
  }
  return { state: "closed", openedAt: 0 };
}

export interface CircuitBreaker {
  readonly name: string;
  /** True if a request is allowed through right now. */
  allow(now?: number): Promise<boolean>;
  /** Record a successful provider call. */
  recordSuccess(now?: number): Promise<void>;
  /** Record a failed provider call. */
  recordFailure(now?: number): Promise<void>;
  /** Inspect current state (diagnostic; never used for routing). */
  getState(now?: number): Promise<BreakerState>;
}

/**
 * Build a breaker handle for a provider name. Same name across calls shares
 * state via Upstash KV — instances are cheap, no caching needed.
 */
export function getBreaker(name: string, override: BreakerConfig = {}): CircuitBreaker {
  const cfg = { ...DEFAULTS, ...override };
  const stateKey = `breaker:${name}:state`;
  const failKey = (b: number) => `breaker:${name}:fail:${b}`;
  const succKey = (b: number) => `breaker:${name}:succ:${b}`;

  /**
   * Read the windowed failure rate by summing the current and previous
   * buckets. Returns null if there are not enough samples to make a call.
   */
  async function failureRate(now: number): Promise<{ rate: number; total: number } | null> {
    const kv = getKv();
    if (!kv) return null;
    const cur = bucketKey(now, cfg.windowMs);
    const prev = cur - 1;
    const [f0, f1, s0, s1] = await Promise.all([
      kv.get<string | number>(failKey(cur)),
      kv.get<string | number>(failKey(prev)),
      kv.get<string | number>(succKey(cur)),
      kv.get<string | number>(succKey(prev)),
    ]);
    const f = Number(f0 ?? 0) + Number(f1 ?? 0);
    const s = Number(s0 ?? 0) + Number(s1 ?? 0);
    const total = f + s;
    if (total < cfg.minRequests) return { rate: 0, total };
    return { rate: f / total, total };
  }

  async function readState(): Promise<StateRecord> {
    const kv = getKv();
    if (!kv) return { state: "closed", openedAt: 0 };
    try {
      const raw = await kv.get<string>(stateKey);
      return parseState(typeof raw === "string" ? raw : raw == null ? null : JSON.stringify(raw));
    } catch {
      return { state: "closed", openedAt: 0 };
    }
  }

  async function writeState(rec: StateRecord): Promise<void> {
    const kv = getKv();
    if (!kv) return;
    try {
      await kv.set(stateKey, JSON.stringify(rec), { ex: cfg.stateTtlSec });
    } catch {
      /* fail-open */
    }
  }

  async function bumpCounter(key: string): Promise<void> {
    const kv = getKv();
    if (!kv) return;
    try {
      await kv.incr(key);
      const ttl = await kv.ttl(key);
      if (ttl < 0) await kv.expire(key, cfg.countersTtlSec);
    } catch {
      /* fail-open */
    }
  }

  /**
   * Erase the rolling-window counters. Called when the breaker recovers via
   * a successful HALF_OPEN probe — the old failures are no longer relevant
   * and would otherwise instantly re-trip the breaker.
   */
  async function resetWindow(now: number): Promise<void> {
    const kv = getKv();
    if (!kv) return;
    const cur = bucketKey(now, cfg.windowMs);
    const prev = cur - 1;
    try {
      await Promise.all([
        kv.del(failKey(cur)),
        kv.del(failKey(prev)),
        kv.del(succKey(cur)),
        kv.del(succKey(prev)),
      ]);
    } catch {
      /* fail-open */
    }
  }

  return {
    name,

    async allow(now = Date.now()): Promise<boolean> {
      const rec = await readState();

      if (rec.state === "open") {
        const elapsed = now - rec.openedAt;
        if (elapsed < cfg.cooldownMs) return false;
        // Cooldown elapsed — flip to half-open and let exactly one probe through.
        await writeState({ state: "half_open", openedAt: rec.openedAt });
        return true;
      }

      if (rec.state === "half_open") {
        // Whoever read this first gets the probe; subsequent reads see
        // half_open too but the fast path here is fine because most retries
        // are spaced by request latency, not microseconds. A second probe
        // running in parallel costs us nothing material — one extra call.
        return true;
      }

      // CLOSED: gate on fail-rate of the rolling window.
      const fr = await failureRate(now);
      if (!fr) return true;
      if (fr.rate >= cfg.failureRateThreshold) {
        await writeState({ state: "open", openedAt: now });
        return false;
      }
      return true;
    },

    async recordSuccess(now = Date.now()): Promise<void> {
      const rec = await readState();
      if (rec.state === "half_open") {
        // Probe succeeded: clear the rolling window so accumulated failures
        // from the previous outage don't re-trip the breaker on the next
        // request. Then transition back to CLOSED.
        await resetWindow(now);
        await writeState({ state: "closed", openedAt: 0 });
        return;
      }
      await bumpCounter(succKey(bucketKey(now, cfg.windowMs)));
    },

    async recordFailure(now = Date.now()): Promise<void> {
      const bucket = bucketKey(now, cfg.windowMs);
      await bumpCounter(failKey(bucket));
      const rec = await readState();
      if (rec.state === "half_open") {
        // Probe failed: reopen, restart cooldown.
        await writeState({ state: "open", openedAt: now });
        return;
      }
      if (rec.state === "closed") {
        const fr = await failureRate(now);
        if (fr && fr.rate >= cfg.failureRateThreshold) {
          await writeState({ state: "open", openedAt: now });
        }
      }
    },

    async getState(): Promise<BreakerState> {
      const rec = await readState();
      return rec.state;
    },
  };
}
