/**
 * The knobs of /admin/metrics, in one place (docs/admin-redesign/PHASE-1.md).
 * Pure constants: safe to import from client components.
 */

export const ADMIN_METRICS_CONFIG = {
  /**
   * Below these prior-window baselines a percentage change says more about the
   * base than the business, so the card shows the absolute change with a
   * "small base" tag instead. Each metric checks its own baseline.
   */
  smallBase: {
    activeSellers: 20,
    /** ₹10,000. */
    gmvPaise: 1_000_000,
  },
  /** Days a metric must sit at exactly 0 (with its related metric above 0) before a tripwire fires. */
  tripwireDays: 7,
  /** Days a dismissed "Possible tracking issue" banner stays hidden on that device. */
  tripwireSnoozeDays: 7,
  tracking: {
    /**
     * `Transaction.orderChannel` was first written by PR #126 (migration
     * 20261104000000_order_channel), merged 04/11/2026 12:36 IST. Earlier
     * orders are null, so Instagram counts start here, not at the window start.
     */
    orderChannelSince: new Date("2026-11-04T07:06:00.000Z"),
  },
} as const;
