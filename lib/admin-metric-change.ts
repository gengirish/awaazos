/**
 * Week-over-week change for /admin/metrics, honest about small numbers.
 *
 * With a prior-window baseline under its threshold (ADMIN_METRICS_CONFIG.smallBase)
 * a percentage is noise: 2 → 5 sellers reads as "+150%". Below the threshold the
 * change is the absolute difference ("+3 sellers", "+₹3,697.15") tagged
 * `smallBase`; at or above it, a percentage. Pure and client-safe.
 */
import { formatINR } from "@/lib/currency";

export type ChangeTone = "up" | "down" | "flat";

export type MetricChange = {
  mode: "percent" | "absolute";
  label: string;
  tone: ChangeTone;
  /** True when the prior baseline is under the threshold, so the percentage is hidden. */
  smallBase: boolean;
};

export type ChangeUnit =
  | { kind: "count"; singular: string; plural: string }
  | { kind: "paise" };

const ONE_DECIMAL = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = "−";

function toneOf(diff: number): ChangeTone {
  if (diff > 0) return "up";
  if (diff < 0) return "down";
  return "flat";
}

function absoluteLabel(diff: number, unit: ChangeUnit): string {
  if (diff === 0) return "No change";
  const sign = diff > 0 ? "+" : MINUS;
  const size = Math.abs(diff);
  if (unit.kind === "paise") return `${sign}${formatINR(size)}`;
  return `${sign}${size.toLocaleString("en-IN")} ${size === 1 ? unit.singular : unit.plural}`;
}

/**
 * `current` and `prior` are window totals in the unit's own terms (a count, or
 * integer paise). `threshold` is the smallest prior baseline that earns a percentage.
 */
export function describeChange(current: number, prior: number, threshold: number, unit: ChangeUnit): MetricChange {
  const diff = current - prior;
  const tone = toneOf(diff);
  if (prior < threshold) {
    return { mode: "absolute", label: absoluteLabel(diff, unit), tone, smallBase: true };
  }
  const pct = (diff / prior) * 100;
  if (Math.abs(pct) < 0.05) return { mode: "percent", label: "0.0%", tone: "flat", smallBase: false };
  const sign = pct > 0 ? "+" : MINUS;
  return { mode: "percent", label: `${sign}${ONE_DECIMAL.format(Math.abs(pct))}%`, tone, smallBase: false };
}
