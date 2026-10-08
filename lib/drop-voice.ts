/**
 * Voice drop builder: pure merge of a parsed `DropDraft` (POST /api/ai/parse-drop)
 * into the drop form's client state. No React, no fetch — unit-tested in
 * `lib/__tests__/drop-voice.test.ts`.
 *
 * Rules:
 * - Only fields the draft actually carries (non-null) are applied; everything
 *   else keeps the vendor's current value. Voice never clears a field.
 * - A non-empty `items` list replaces the item selection. A dish the vendor had
 *   already edited keeps those edits unless voice gave that value.
 * - Nothing is saved here: the vendor still presses the form's save button.
 * - The caller keeps the pre-voice snapshot for "Undo voice changes"; this
 *   module never mutates its input.
 */
import { paiseToRupees } from "@/lib/currency";
import { isValidYmd, shiftOrderWindowDates } from "@/lib/drops-builder";
import type { DropDraft } from "@/lib/parse-drop-types";
import type { DropUpsertInput } from "@/lib/zod-drops";

// ─── Form state (owned by components/drops/DropForm.tsx) ────────────

export type DropFormFields = {
  title: string;
  note: string;
  date: string;
  fulfilmentMode: DropUpsertInput["fulfilmentMode"];
  fulfilmentStart: string;
  fulfilmentEnd: string;
  /** Rupees as typed, e.g. "30" or "12.5" — converted to paise on submit. */
  deliveryFee: string;
  pickupNote: string;
  closesAtDate: string;
  closesAtTime: string;
  useOpensAt: boolean;
  opensAtDate: string;
  opensAtTime: string;
  showEverydayMenu: boolean;
};

/** One menu item's row in the drop form. Prices/counts are input strings. */
export type DropFormRow = { selected: boolean; price: string; maxQty: string; perOrderLimit: string };

export type DropFormSnapshot = {
  form: DropFormFields;
  rows: Record<string, DropFormRow>;
  /** Menu item ids in display order; selected ids' order becomes `sortOrder`. */
  order: string[];
};

/** Which form fields / dishes came from voice — drives the "From voice" badges. */
export type VoiceMarks = { fields: (keyof DropFormFields)[]; items: string[] };

export const NO_VOICE_MARKS: VoiceMarks = { fields: [], items: [] };

export function paiseToRupeeInput(paise: number): string {
  return String(paiseToRupees(paise));
}

// ─── Draft shape this module relies on ──────────────────────────────

type Maybe<T> = T | null | undefined;

/**
 * The subset of `DropDraft` the merge reads, all optional/nullable so a sparse
 * draft is fine. `DropDraft` must stay assignable to it (checked below).
 */
export type VoiceDropDraftInput = {
  title?: Maybe<string>;
  note?: Maybe<string>;
  date?: Maybe<string>;
  fulfilmentMode?: Maybe<DropUpsertInput["fulfilmentMode"]>;
  fulfilmentStart?: Maybe<string>;
  fulfilmentEnd?: Maybe<string>;
  pickupNote?: Maybe<string>;
  deliveryFeePaise?: Maybe<number>;
  opensAtDate?: Maybe<string>;
  opensAtTime?: Maybe<string>;
  closesAtDate?: Maybe<string>;
  closesAtTime?: Maybe<string>;
  showEverydayMenu?: Maybe<boolean>;
  items?: Maybe<
    readonly {
      menuItemId: string;
      priceInPaise?: Maybe<number>;
      maxQty?: Maybe<number>;
      perOrderLimit?: Maybe<number>;
      sortOrder?: Maybe<number>;
    }[]
  >;
  filled?: Maybe<readonly string[]>;
};

// Compile-time guard: fails typecheck if the API's DropDraft drifts away from
// what the merge reads.
const _draftFits = (d: DropDraft): VoiceDropDraftInput => d;
void _draftFits;

/** Draft key → the form field(s) it fills. */
const FIELD_MAP: Record<string, (keyof DropFormFields)[]> = {
  title: ["title"],
  note: ["note"],
  date: ["date"],
  fulfilmentMode: ["fulfilmentMode"],
  fulfilmentStart: ["fulfilmentStart"],
  fulfilmentEnd: ["fulfilmentEnd"],
  pickupNote: ["pickupNote"],
  deliveryFeePaise: ["deliveryFee"],
  opensAtDate: ["opensAtDate", "useOpensAt"],
  opensAtTime: ["opensAtTime", "useOpensAt"],
  closesAtDate: ["closesAtDate"],
  closesAtTime: ["closesAtTime"],
  showEverydayMenu: ["showEverydayMenu"],
};

/** Badge-able fields shown in the summary count (`useOpensAt` rides along with opensAt*). */
const COUNTED_FIELDS = new Set<keyof DropFormFields>(
  Object.values(FIELD_MAP)
    .flat()
    .filter((k) => k !== "useOpensAt"),
);

export type MergeResult = {
  next: DropFormSnapshot;
  marks: VoiceMarks;
  /** Form fields filled (not counting dishes). */
  fieldCount: number;
  /** Dishes selected from voice. */
  dishCount: number;
  /** Draft items whose id isn't on this vendor's menu (dropped, never trusted). */
  unknownItemIds: string[];
};

function positiveInt(n: Maybe<number>): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * Apply a parsed draft to the current form snapshot.
 *
 * `menuItems` is the vendor's menu (the form's own list): items not on it are
 * ignored, and a dish voice didn't price falls back to the row's current price.
 */
export function mergeDropDraft(
  prev: DropFormSnapshot,
  draft: VoiceDropDraftInput,
  menuItems: readonly { id: string; priceInPaise: number }[],
  /** Order-window dates the vendor set by hand this session (not shifted with the cooking day). */
  touchedDates: { closesAtDate: boolean; opensAtDate: boolean } = { closesAtDate: false, opensAtDate: false },
): MergeResult {
  let form: DropFormFields = { ...prev.form };
  const applied = new Set<keyof DropFormFields>();
  const appliedKeys: string[] = [];
  const d = draft as Record<string, unknown>;

  // Apply only what the vendor actually said. The API also returns defaults it
  // inferred (mode, window, fee, date…) — applying those would silently reset an
  // existing drop's values on the edit page. Without a `filled` list (older API),
  // fall back to applying everything present.
  const filled = draft.filled && draft.filled.length > 0 ? new Set<string>(draft.filled) : null;
  const wanted = (key: string) => !filled || filled.has(key);

  const str = (key: string): string | null => {
    const v = d[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const mark = (key: string) => {
    appliedKeys.push(key);
    FIELD_MAP[key]?.forEach((f) => applied.add(f));
  };

  // Cooking day first, so order-window dates the draft doesn't set move with it
  // exactly as they do when the vendor picks a new day by hand.
  const date = wanted("date") ? str("date") : null;
  if (date && isValidYmd(date)) {
    if (date !== form.date) {
      form = { ...shiftOrderWindowDates(form, form.date, date, touchedDates), date };
    }
    mark("date");
  }

  for (const key of ["title", "note", "fulfilmentStart", "fulfilmentEnd", "pickupNote", "closesAtTime"] as const) {
    const v = wanted(key) ? str(key) : null;
    if (v !== null) {
      form[key] = v;
      mark(key);
    }
  }
  for (const key of ["closesAtDate", "opensAtDate"] as const) {
    const v = wanted(key) ? str(key) : null;
    if (v !== null && isValidYmd(v)) {
      form[key] = v;
      mark(key);
    }
  }
  const opensAtTime = wanted("opensAtTime") ? str("opensAtTime") : null;
  if (opensAtTime !== null) {
    form.opensAtTime = opensAtTime;
    mark("opensAtTime");
  }
  if (applied.has("opensAtDate") || applied.has("opensAtTime")) form.useOpensAt = true;

  if (
    wanted("fulfilmentMode") &&
    (draft.fulfilmentMode === "DELIVERY" || draft.fulfilmentMode === "PICKUP" || draft.fulfilmentMode === "BOTH")
  ) {
    form.fulfilmentMode = draft.fulfilmentMode;
    mark("fulfilmentMode");
  }
  if (
    wanted("deliveryFeePaise") &&
    typeof draft.deliveryFeePaise === "number" &&
    Number.isInteger(draft.deliveryFeePaise) &&
    draft.deliveryFeePaise >= 0
  ) {
    form.deliveryFee = paiseToRupeeInput(draft.deliveryFeePaise);
    mark("deliveryFeePaise");
  }
  if (wanted("showEverydayMenu") && typeof draft.showEverydayMenu === "boolean") {
    form.showEverydayMenu = draft.showEverydayMenu;
    mark("showEverydayMenu");
  }

  // ── Items ──
  const menuById = new Map(menuItems.map((m) => [m.id, m]));
  const rows: Record<string, DropFormRow> = { ...prev.rows };
  let order = prev.order;
  const voiceItems: string[] = [];
  const unknownItemIds: string[] = [];

  const draftItems = (draft.items ?? [])
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => (a.it.sortOrder ?? a.idx) - (b.it.sortOrder ?? b.idx) || a.idx - b.idx)
    .map(({ it }) => it);

  const known = draftItems.filter((it) => {
    if (menuById.has(it.menuItemId)) return true;
    unknownItemIds.push(it.menuItemId);
    return false;
  });

  if (known.length > 0) {
    // Replace the selection: everything off, then the voice dishes on.
    for (const id of Object.keys(rows)) {
      if (rows[id].selected) rows[id] = { ...rows[id], selected: false };
    }
    for (const it of known) {
      if (voiceItems.includes(it.menuItemId)) continue;
      const m = menuById.get(it.menuItemId)!;
      const current: DropFormRow = rows[it.menuItemId] ?? {
        selected: false,
        price: paiseToRupeeInput(m.priceInPaise),
        maxQty: "",
        perOrderLimit: "",
      };
      rows[it.menuItemId] = {
        selected: true,
        price: positiveInt(it.priceInPaise) ? paiseToRupeeInput(it.priceInPaise) : current.price,
        maxQty: positiveInt(it.maxQty) ? String(it.maxQty) : current.maxQty,
        perOrderLimit: positiveInt(it.perOrderLimit) ? String(it.perOrderLimit) : current.perOrderLimit,
      };
      voiceItems.push(it.menuItemId);
    }
    // Voice dishes first in spoken order, then the rest as they were.
    const rest = prev.order.filter((id) => !voiceItems.includes(id));
    order = [...voiceItems, ...rest];
  }

  // Badges: everything applied was said (see `wanted`), so badge it all.
  const fields = [...new Set(appliedKeys.flatMap((k) => FIELD_MAP[k]))];

  return {
    next: { form, rows, order },
    marks: { fields, items: voiceItems },
    fieldCount: [...applied].filter((f) => COUNTED_FIELDS.has(f)).length,
    dishCount: voiceItems.length,
    unknownItemIds,
  };
}

/** "Filled 6 fields and 3 dishes — check and save". */
export function voiceSummary(fieldCount: number, dishCount: number): string {
  const parts: string[] = [];
  if (fieldCount > 0) parts.push(`${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`);
  if (dishCount > 0) parts.push(`${dishCount} ${dishCount === 1 ? "dish" : "dishes"}`);
  if (parts.length === 0) return "Nothing to fill from that — try again or fill the form below";
  return `Filled ${parts.join(" and ")} — check and save`;
}

/** Drop a field's badge once the vendor edits it by hand. */
export function unmarkField(marks: VoiceMarks, key: keyof DropFormFields): VoiceMarks {
  return marks.fields.includes(key) ? { ...marks, fields: marks.fields.filter((f) => f !== key) } : marks;
}

export function unmarkItem(marks: VoiceMarks, id: string): VoiceMarks {
  return marks.items.includes(id) ? { ...marks, items: marks.items.filter((i) => i !== id) } : marks;
}
