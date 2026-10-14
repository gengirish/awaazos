/**
 * The admin "New demo store" form (/admin/demo-stores/new) → the same payload
 * the internal API takes (lib/demo-store-schema.ts). Pure and client-safe: the
 * browser builds the payload, the server validates it again in full.
 *
 * Sample orders are generated from the dishes so every demo shows the same
 * story (docs/INTERNAL_DEMO_STORES.md): two advances pending, three confirmed
 * with a balance due, one nearly paid, one fully paid and one overdue balance,
 * dated around today in IST. Customer names are fictional and phones are the
 * reserved 9199999000xx range.
 */
import { rupeesToPaise } from "@/lib/currency";
import type { DemoLanguage, DemoSampleOrderInput, DemoStoreCreateInput } from "@/lib/demo-store-schema";

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SAMPLE_NAMES = ["Meghana", "Karthik", "Nandini", "Rohan", "Lavanya", "Prakash", "Shreya", "Vikram"] as const;

/**
 * One sample order per row: which dishes (by position, wrapping round the
 * list), days from today, the time of day, the advance in basis points of the
 * total, and the status.
 */
const SAMPLE_PLAN: readonly {
  lines: readonly { item: number; qty: number }[];
  dayOffset: number;
  time: string;
  advanceBps: number;
  status: "placed" | "confirmed";
}[] = [
  { lines: [{ item: 0, qty: 1 }], dayOffset: 8, time: "18:00", advanceBps: 0, status: "placed" },
  { lines: [{ item: 1, qty: 2 }], dayOffset: 10, time: "11:00", advanceBps: 0, status: "placed" },
  { lines: [{ item: 2, qty: 1 }], dayOffset: 4, time: "19:00", advanceBps: 4_000, status: "confirmed" },
  { lines: [{ item: 3, qty: 1 }, { item: 4, qty: 1 }], dayOffset: 6, time: "17:00", advanceBps: 5_000, status: "confirmed" },
  { lines: [{ item: 5, qty: 2 }], dayOffset: 9, time: "18:00", advanceBps: 3_000, status: "confirmed" },
  { lines: [{ item: 0, qty: 1 }], dayOffset: 2, time: "18:30", advanceBps: 8_000, status: "confirmed" },
  { lines: [{ item: 6, qty: 1 }, { item: 1, qty: 1 }], dayOffset: 1, time: "16:00", advanceBps: 10_000, status: "confirmed" },
  { lines: [{ item: 2, qty: 1 }, { item: 3, qty: 1 }], dayOffset: -3, time: "18:00", advanceBps: 5_000, status: "confirmed" },
];

/** "YYYY-MM-DD" of the IST calendar day `dayOffset` days from `now`. */
function istYmd(now: Date, dayOffset: number): string {
  return new Date(now.getTime() + IST_OFFSET_MS + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** The eight sample orders for these dishes. Needs at least one dish. */
export function buildSampleOrders(
  items: readonly { name: string; price_paise: number }[],
  now: Date = new Date(),
): DemoSampleOrderInput[] {
  if (items.length === 0) return [];
  return SAMPLE_PLAN.map((plan, i) => {
    // Fewer dishes than the plan names wrap round; repeats of one dish merge.
    const qtyByItem = new Map<number, number>();
    for (const line of plan.lines) {
      const idx = line.item % items.length;
      qtyByItem.set(idx, (qtyByItem.get(idx) ?? 0) + line.qty);
    }
    const lines = [...qtyByItem].map(([idx, qty]) => ({ item: items[idx].name, qty }));
    const total = [...qtyByItem].reduce((sum, [idx, qty]) => sum + items[idx].price_paise * qty, 0);
    return {
      customer_name: SAMPLE_NAMES[i],
      customer_phone: `9199999000${String(i + 1).padStart(2, "0")}`,
      lines,
      event_date: `${istYmd(now, plan.dayOffset)}T${plan.time}:00+05:30`,
      advance_paid_paise: Math.floor((total * plan.advanceBps) / 10_000),
      status: plan.status,
    };
  });
}

/** A suggested external_ref from the store name and the first part of the area. */
export function suggestExternalRef(name: string, area: string): string {
  const slug = `${name} ${area.split(",")[0] ?? ""}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

export type DemoStoreFormItem = { name: string; unit: string; priceRupees: string; category: string };

export type DemoStoreFormValues = {
  externalRef: string;
  name: string;
  category: DemoStoreCreateInput["profile"]["category"];
  area: string;
  instagram: string;
  displayPhone: string;
  languages: DemoLanguage[];
  fulfilment: DemoStoreCreateInput["profile"]["fulfilment"];
  deliveryFeeRupees: string;
  items: DemoStoreFormItem[];
  withSampleOrders: boolean;
};

export type BuildResult = { ok: true; payload: DemoStoreCreateInput } | { ok: false; error: string };

function rupees(value: string, label: string): number | string {
  const n = Number(value.trim());
  if (value.trim() === "" || !Number.isFinite(n) || n < 0) return `${label}: enter an amount in rupees.`;
  try {
    return rupeesToPaise(n);
  } catch {
    return `${label}: use at most 2 decimal places.`;
  }
}

/** Form → API payload. Blank dish rows are skipped; the server re-validates everything. */
export function buildDemoStorePayload(form: DemoStoreFormValues, now: Date = new Date()): BuildResult {
  const items: DemoStoreCreateInput["items"] = [];
  for (const row of form.items) {
    if (!row.name.trim() && !row.priceRupees.trim()) continue;
    if (!row.name.trim()) return { ok: false, error: "Every dish with a price needs a name." };
    const price = rupees(row.priceRupees, row.name.trim());
    if (typeof price === "string") return { ok: false, error: price };
    if (price <= 0) return { ok: false, error: `${row.name.trim()}: the price must be more than ₹0.` };
    items.push({
      name: row.name.trim(),
      price_paise: price,
      ...(row.unit.trim() ? { unit: row.unit.trim() } : {}),
      ...(row.category.trim() ? { category: row.category.trim() } : {}),
    });
  }
  if (items.length === 0) return { ok: false, error: "Add at least one dish with a price." };

  let deliveryFee = 0;
  if (form.fulfilment !== "pickup" && form.deliveryFeeRupees.trim()) {
    const fee = rupees(form.deliveryFeeRupees, "Delivery fee");
    if (typeof fee === "string") return { ok: false, error: fee };
    deliveryFee = fee;
  }

  return {
    ok: true,
    payload: {
      external_ref: form.externalRef.trim(),
      profile: {
        name: form.name.trim(),
        category: form.category,
        ...(form.area.trim() ? { area: form.area.trim() } : {}),
        ...(form.instagram.trim() ? { instagram: form.instagram.trim() } : {}),
        ...(form.displayPhone.trim() ? { display_phone: form.displayPhone.replace(/[\s-]/g, "") } : {}),
        languages: form.languages.length > 0 ? form.languages : ["en"],
        fulfilment: form.fulfilment,
        delivery_fee_paise: deliveryFee,
      },
      items,
      sample_orders: form.withSampleOrders ? buildSampleOrders(items, now) : [],
    },
  };
}
