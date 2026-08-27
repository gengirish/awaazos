/**
 * Money helpers — amounts in paise (integer). See `.cursor/rules/money.mdc`.
 */

export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new Error("paise must be an integer");
  }
  return paise / 100;
}

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error("Invalid rupee amount");
  }
  const scaled = rupees * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-9) {
    throw new Error("Rupee amount must have at most 2 decimal places");
  }
  return rounded;
}

export function formatINR(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error("paise must be an integer");
  }
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Menu-board formatting: `₹50` for a whole-rupee price, `₹12.50` when there
 * really are paise. Display only — never use this on a bill, a receipt, or an
 * export, where `formatINR()`'s fixed two decimals are what reconciles.
 */
export function formatINRCompact(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error("paise must be an integer");
  }
  if (paise % 100 !== 0) return formatINR(paise);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(paiseToRupees(paise));
}

export function sumPaise(items: number[]): number {
  let total = 0;
  for (const p of items) {
    if (!Number.isInteger(p)) {
      throw new Error("Each paise value must be an integer");
    }
    total += p;
  }
  return total;
}
