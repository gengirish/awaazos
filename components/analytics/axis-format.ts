/**
 * Short rupee labels for chart axes: "₹850", "₹1.5k", "₹12k", "₹2.4L", "₹1.2Cr".
 *
 * A Y axis has ~48 px on a phone, and `formatINR()` ("₹12,000.00") does not fit
 * there. Axis ticks only — tooltips, KPI tiles and the data tables keep
 * `formatINR()`, so no amount a vendor reads off as a figure is ever shortened.
 *
 * Takes paise like every other amount (a chart tick can be fractional, so the
 * value is floored to whole rupees first) and uses integer arithmetic only.
 * Indian units (lakh, crore), rounded down to one decimal.
 */
export function formatAxisINR(paise: number): string {
  if (!Number.isFinite(paise) || paise <= 0) return "₹0";
  const rupees = Math.floor(paise / 100);
  if (rupees < 1000) return `₹${rupees}`;

  const [divisor, unit] =
    rupees >= 1_00_00_000 ? [1_00_00_000, "Cr"] : rupees >= 1_00_000 ? [1_00_000, "L"] : [1000, "k"];
  const whole = Math.floor(rupees / divisor);
  const tenth = Math.floor(((rupees % divisor) * 10) / divisor);
  return `₹${whole}${tenth > 0 ? `.${tenth}` : ""}${unit}`;
}

/** Whole-number share of `part` in `total`, 0 when there is no total. Display only. */
export function sharePercent(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.floor((part * 100 + total / 2) / total);
}
