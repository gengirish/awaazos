/**
 * Voice drop builder: transcript → DRAFT drop (nothing is saved here).
 *
 * Same shape as the order path (lib/anthropic.ts):
 *   - STT already happened; only the transcript + this vendor's menu reach Claude.
 *   - Forced `build_drop` tool use, Haiku primary → Sonnet escalation.
 *   - Menu block = `stableMenuJson()` with `cache_control: ephemeral`; today's
 *     IST date/time and the transcript sit in a later, uncached block so the
 *     cached prefix stays byte-identical across calls.
 *   - Model output is never trusted: relative days are resolved here from server
 *     time (IST), times are re-validated, every item is re-anchored to a real
 *     MenuItem of THIS vendor, rupees → paise go through `rupeesToPaise`.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
  stableMenuJson,
  type MenuItemForParse,
} from "@/lib/anthropic";
import { rupeesToPaise } from "@/lib/currency";
import {
  addDaysYmd,
  defaultCutoffFor,
  DEFAULT_CUTOFF_TIME,
  isValidYmd,
  istTodayYmd,
  LATE_CUTOFF_TIME,
  PER_ORDER_OVER_MAX,
} from "@/lib/drops-builder";
import { istToUtc, utcToIstParts, ymdToDbDate } from "@/lib/drops-time";
import { rescueMatchFromTranscript } from "@/lib/parse-order-align";
import type {
  DropDraft,
  DropDraftField,
  DropDraftItem,
  DropDraftUnmatched,
} from "@/lib/parse-drop-types";
import { dropUpsertSchema } from "@/lib/zod-drops";

export type { DropDraft, DropDraftField, DropDraftItem, DropDraftUnmatched } from "@/lib/parse-drop-types";

// ─── Limits (mirror dropUpsertSchema / dropItemInputSchema) ──────────────────

export const DRAFT_MAX_QTY = 10_000;
export const DRAFT_MAX_PER_ORDER = 1_000;
const MAX_DELIVERY_FEE_PAISE = 100_000;
const MAX_ITEMS = 100;
const DEFAULT_WINDOW_START = "17:00";
const DEFAULT_WINDOW_END = "20:00";
const DEFAULT_WINDOW_MINUTES = 180;

// ─── Prompt + tool ───────────────────────────────────────────────────────────

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type Weekday = (typeof WEEKDAYS)[number];

const DAY_KINDS = [
  "today",
  "tomorrow",
  "day_after_tomorrow",
  "weekday",
  "date",
  "fulfilment_day",
  "day_before_fulfilment",
] as const;

const DROP_BUILD_SYSTEM = `You turn an Indian home cook's spoken plan for a "drop" (a one-day pre-order batch) into a draft for a form they will review.
Use the build_drop tool exactly once. Only fill a field when the cook actually said it; leave everything else out. Never invent prices, quantities or times.

Speech is Hinglish, English or Hindi (sometimes Telugu/Kannada/Tamil transliterated) and comes from speech-to-text, so words may be misheard. Match items phonetically to menu names/aliases/slugs.

Items:
- menuItemId MUST be an "id" from the menu JSON, or null when nothing on the menu plausibly matches. Never invent ids, never use "slug".
- spokenName = the words the cook used for the item.
- quantity = how many they will make (capacity). A bare number next to an item is the quantity ("banana bread 10" → quantity 10).
- priceRupees only when a price is said with a money word (rupaye, rupees, rs, ₹, "ka", "each", "per piece"). Otherwise leave it out — the menu price is used.
- perOrderLimit only for phrases like "ek order mein max 2", "2 per customer".
- Serving/pack words (plate, piece, packet, dabba, box, jar) are not items: "15 dabba thepla" → thepla quantity 15.

Numbers:
- hi: ek 1, do 2, teen 3, char 4, paanch 5, chhe 6, saat 7, aath 8, nau 9, das 10, gyarah 11, barah 12, pandrah 15, bees 20, pachees 25, tees 30, chalees 40, pachaas 50, saath 60, sattar 70, assi 80, nabbe 90, sau 100, hazaar 1000
- dedh 1.5 (dedh sau 150), dhai 2.5 (dhai sau 250), saade X = X.5 (saade teen sau 350), sava X = X.25, paune X = X − 0.25
- te: okati 1, rendu 2, moodu 3, naalugu 4, aidu 5, padi 10, iravai 20 · kn: ondu 1, eradu 2, mooru 3, naalku 4, aidu 5 · ta: onnu 1, rendu 2, moonu 3, naangu 4, anju 5

Days (all IST; today's date is given with the transcript):
- day.kind: "today" (aaj), "tomorrow" (kal — in a plan for the future kal means tomorrow), "day_after_tomorrow" (parson), "weekday" (+ weekday: somvaar monday, mangalvaar tuesday, budhvaar wednesday, guruvaar/veervaar thursday, shukravaar friday, shanivaar saturday, ravivaar/itvaar sunday), or "date" (+ date YYYY-MM-DD) for an explicit calendar date.
- te: ivala today, repu tomorrow · kn: ivattu today, naale tomorrow · ta: indru today, naalai tomorrow.
- cutoffDay / opensDay may also be "fulfilment_day" (same day as cooking) or "day_before_fulfilment". Leave cutoffDay out if only a time was said.

Times → 24h "HH:MM":
- subah = morning (subah 8 → 08:00), dopahar = afternoon (dopahar 2 → 14:00, dopahar 12 → 12:00), shaam = evening (shaam 6 → 18:00), raat = night (raat 9 → 21:00). "baje" = o'clock. saade 6 → 6:30, sava 7 → 7:15, paune 8 → 7:45.
- With no part-of-day word, pick the reading that fits a home-kitchen day: pickup/delivery is usually afternoon or evening ("6 se 8" → 18:00–20:00), and the order cut-off comes before pickup starts.
- "se ... tak" = from ... until. "order X baje tak" / "orders close X" = cut-off. "orders khulenge X" / "orders open X" = opensAt.

Fulfilment: pickup/le jao/aake le lo → PICKUP; delivery/ghar pe bhejenge → DELIVERY; both → BOTH. deliveryFeeRupees only if a delivery charge is said. pickupNote = where/how to collect if said (e.g. "gate number 2 pe").
showEverydayMenu only if the cook explicitly says to also show the regular/everyday menu (true) or not (false).
title only if the cook names the drop; note = any other customer-facing remark said for the drop.
Put any fragment you could not place into unparsed.

The authoritative menu JSON is provided in a separate user message block (cached).`;

const dayRefSchemaJson = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...DAY_KINDS] },
    weekday: { type: "string", enum: [...WEEKDAYS] },
    date: { type: "string", description: "YYYY-MM-DD, only for kind=date" },
  },
  required: ["kind"],
} as const;

const HM_DESC = "24h HH:MM, IST";

export const BUILD_DROP_TOOL: Anthropic.Tool = {
  name: "build_drop",
  description: "Fill a draft pre-order drop from the cook's spoken plan. Omit anything not said.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      note: { type: "string" },
      day: { ...dayRefSchemaJson, description: "Cooking / pickup / delivery day" },
      fulfilmentMode: { type: "string", enum: ["DELIVERY", "PICKUP", "BOTH"] },
      windowStart: { type: "string", description: HM_DESC },
      windowEnd: { type: "string", description: HM_DESC },
      cutoffDay: { ...dayRefSchemaJson, description: "Day orders close" },
      cutoffTime: { type: "string", description: HM_DESC },
      opensDay: { ...dayRefSchemaJson, description: "Day orders open" },
      opensTime: { type: "string", description: HM_DESC },
      deliveryFeeRupees: { type: "number" },
      pickupNote: { type: "string" },
      showEverydayMenu: { type: "boolean" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            menuItemId: { type: ["string", "null"] },
            spokenName: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
            priceRupees: { type: "number" },
            perOrderLimit: { type: "integer", minimum: 1 },
          },
          required: ["menuItemId", "spokenName"],
        },
      },
      unparsed: { type: "array", items: { type: "string" } },
    },
    required: ["items"],
  },
};

// ─── Tool-input validation (lenient: coerce, then re-check everything) ───────

/** null / "" → undefined; numeric strings → number. No money rounding here. */
const optNum = z.preprocess(
  (v) => (v === null || v === "" ? undefined : typeof v === "string" ? Number(v) : v),
  z.number().finite().optional(),
);
const optStr = z.preprocess((v) => (v === null ? undefined : v), z.string().optional());
const optBool = z.preprocess((v) => (v === null ? undefined : v), z.boolean().optional());

const dayRefSchema = z
  .object({
    kind: z.enum(DAY_KINDS),
    weekday: z.preprocess(
      (v) => (typeof v === "string" ? v.toLowerCase() : v === null ? undefined : v),
      z.enum(WEEKDAYS).optional(),
    ),
    date: optStr,
  })
  .nullish();

export const buildDropInputSchema = z.object({
  title: optStr,
  note: optStr,
  day: dayRefSchema,
  fulfilmentMode: z.preprocess((v) => (v === null ? undefined : v), z.enum(["DELIVERY", "PICKUP", "BOTH"]).optional()),
  windowStart: optStr,
  windowEnd: optStr,
  cutoffDay: dayRefSchema,
  cutoffTime: optStr,
  opensDay: dayRefSchema,
  opensTime: optStr,
  deliveryFeeRupees: optNum,
  pickupNote: optStr,
  showEverydayMenu: optBool,
  items: z
    .array(
      z.object({
        menuItemId: z.preprocess((v) => (v === "" ? null : v), z.string().nullish()),
        spokenName: z.string().default(""),
        quantity: optNum,
        priceRupees: optNum,
        perOrderLimit: optNum,
      }),
    )
    .default([]),
  unparsed: z.array(z.string()).default([]),
});

export type BuildDropToolInput = z.infer<typeof buildDropInputSchema>;
type DayRef = NonNullable<BuildDropToolInput["day"]>;

// ─── Claude call ─────────────────────────────────────────────────────────────

function istWeekday(ymd: string): Weekday {
  return WEEKDAYS[new Date(`${ymd}T00:00:00.000Z`).getUTCDay()]!;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The uncached per-request block: today in IST + the transcript. */
export function dropUserTurnText(transcript: string, lang: string, now: Date): string {
  const { ymd, hm } = utcToIstParts(now);
  return `Today (IST): ${capitalise(istWeekday(ymd))} ${ymd}, time now ${hm}.\nCook's plan (${lang}):\n${transcript}`;
}

function extractBuildDropInput(message: Anthropic.Messages.Message): unknown {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "build_drop") return block.input;
  }
  throw new Error("No build_drop tool_use in response");
}

/** One forced build_drop call. Throws on API error, missing tool_use, or invalid input. */
export async function buildDropWithClaude(
  modelClient: Anthropic,
  modelName: string,
  menuItems: MenuItemForParse[],
  transcript: string,
  lang: string,
  now: Date,
): Promise<BuildDropToolInput> {
  const message = await modelClient.messages.create({
    model: modelName,
    max_tokens: 1024,
    temperature: 0.1,
    system: DROP_BUILD_SYSTEM,
    tools: [BUILD_DROP_TOOL],
    tool_choice: { type: "tool", name: "build_drop", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Authoritative menu (JSON):\n${stableMenuJson(menuItems)}`,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: dropUserTurnText(transcript, lang, now) },
        ],
      },
    ],
  });
  return buildDropInputSchema.parse(extractBuildDropInput(message));
}

function wordCount(transcript: string): number {
  return transcript.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Escalate Haiku → Sonnet (besides a Haiku throw) when:
 *  (a) no items at all on a > 3-word transcript, or
 *  (b) at least half the spoken items have no valid menu id (null or unknown).
 */
export function shouldEscalateDrop(
  result: BuildDropToolInput,
  transcript: string,
  menuItems: MenuItemForParse[],
): boolean {
  if (result.items.length === 0) return wordCount(transcript) > 3;
  const ids = new Set(menuItems.map((m) => m.id));
  const unknown = result.items.filter((i) => !i.menuItemId || !ids.has(i.menuItemId)).length;
  return unknown > 0 && unknown * 2 >= result.items.length;
}

export type ParseDropOutcome = {
  draft: DropDraft;
  modelUsed: string;
  escalated: boolean;
};

/**
 * Full pipeline: Haiku → (maybe) Sonnet → post-process. Throws only when no
 * tier produced a usable tool call.
 */
export async function parseDropFromTranscript(opts: {
  menuItems: MenuItemForParse[];
  transcript: string;
  lang: string;
  now?: Date;
  clients?: { haiku: Anthropic; sonnet: Anthropic };
}): Promise<ParseDropOutcome> {
  const now = opts.now ?? new Date();
  const haiku = opts.clients?.haiku ?? anthropicHaiku;
  const sonnet = opts.clients?.sonnet ?? anthropicSonnet;
  const run = (client: Anthropic, model: string) =>
    buildDropWithClaude(client, model, opts.menuItems, opts.transcript, opts.lang, now);

  let raw: BuildDropToolInput;
  let tier: "haiku" | "sonnet" = "haiku";
  try {
    raw = await run(haiku, ANTHROPIC_PRIMARY_MODEL);
  } catch {
    tier = "sonnet";
    raw = await run(sonnet, ANTHROPIC_FALLBACK_MODEL);
  }
  if (tier === "haiku" && shouldEscalateDrop(raw, opts.transcript, opts.menuItems)) {
    try {
      raw = await run(sonnet, ANTHROPIC_FALLBACK_MODEL);
      tier = "sonnet";
    } catch {
      // Haiku's weak-but-valid answer beats nothing; the vendor reviews it anyway.
    }
  }

  return {
    draft: postProcessDropDraft(raw, opts.menuItems, now, tier),
    modelUsed: tier === "sonnet" ? ANTHROPIC_FALLBACK_MODEL : ANTHROPIC_PRIMARY_MODEL,
    escalated: tier === "sonnet",
  };
}

// ─── Post-processing (never trust the model) ─────────────────────────────────

const HM_STRICT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "6:30" / "06:30" / "18" / "18.30" → "HH:MM", or null when it isn't a real time. */
export function normaliseHm(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  const hm = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return HM_STRICT.test(hm) ? hm : null;
}

function hmToMin(hm: string): number {
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
}

function minToHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "18:00" → "6:00 pm" for warnings. */
function hmLabel(hm: string): string {
  const total = hmToMin(hm);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Resolve a day reference to an IST "YYYY-MM-DD" from server time. */
export function resolveDayRef(
  ref: DayRef | null | undefined,
  todayYmd: string,
  fulfilmentYmd?: string,
): string | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "today":
      return todayYmd;
    case "tomorrow":
      return addDaysYmd(todayYmd, 1);
    case "day_after_tomorrow":
      return addDaysYmd(todayYmd, 2);
    case "weekday": {
      if (!ref.weekday) return null;
      const target = WEEKDAYS.indexOf(ref.weekday);
      const current = WEEKDAYS.indexOf(istWeekday(todayYmd));
      return addDaysYmd(todayYmd, (target - current + 7) % 7);
    }
    case "date": {
      const d = ref.date?.trim();
      return d && isRealDay(d) ? d : null;
    }
    case "fulfilment_day":
      return fulfilmentYmd ?? null;
    case "day_before_fulfilment":
      return fulfilmentYmd ? addDaysYmd(fulfilmentYmd, -1) : null;
  }
}

/** "YYYY-MM-DD" that names a day that exists ("2026-02-30" does not). */
function isRealDay(ymd: string): boolean {
  if (!isValidYmd(ymd)) return false;
  try {
    ymdToDbDate(ymd);
    return true;
  } catch {
    return false;
  }
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function trimTo(s: string | undefined, max: number): string | undefined {
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
}

/** Spoken rupees → paise, or null when it isn't a usable money amount. */
function spokenRupeesToPaise(rupees: number): number | null {
  try {
    return rupeesToPaise(rupees);
  } catch {
    return null;
  }
}

/**
 * Model tool input → DropDraft. Pure (given `now`): resolves days in IST,
 * re-validates times, re-anchors items to `menuItems`, converts money to
 * paise, clamps counts, fills form defaults and collects warnings.
 */
export function postProcessDropDraft(
  raw: BuildDropToolInput,
  menuItems: MenuItemForParse[],
  now: Date,
  model: "haiku" | "sonnet",
): DropDraft {
  const warnings: string[] = [];
  const filled: DropDraftField[] = [];
  /** Fields that already carry a specific warning — schema issues for them are not repeated. */
  const warned = new Set<string>();
  const warn = (msg: string, field?: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
    if (field) warned.add(field);
  };
  const todayYmd = istTodayYmd(now);
  const draft: DropDraft = { items: [], unmatched: [], warnings, filled, model };

  // ── Text fields
  const title = trimTo(raw.title, 80);
  if (title) {
    draft.title = title;
    filled.push("title");
  }
  const note = trimTo(raw.note, 280);
  if (note) {
    draft.note = note;
    filled.push("note");
  }
  const pickupNote = trimTo(raw.pickupNote, 200);
  if (pickupNote) {
    draft.pickupNote = pickupNote;
    filled.push("pickupNote");
  }
  if (typeof raw.showEverydayMenu === "boolean") {
    draft.showEverydayMenu = raw.showEverydayMenu;
    filled.push("showEverydayMenu");
  } else {
    draft.showEverydayMenu = false;
  }

  // ── Cooking day (default: tomorrow, like the new-drop form)
  const spokenDate = resolveDayRef(raw.day, todayYmd);
  const date = spokenDate ?? addDaysYmd(todayYmd, 1);
  draft.date = date;
  if (spokenDate) filled.push("date");
  else if (raw.day) warn("Couldn't understand the day — set to tomorrow, please check", "date");
  if (date < todayYmd) warn("The cooking day is in the past — please pick a date", "date");

  // ── Delivery fee + mode
  let feePaise: number | undefined;
  if (raw.deliveryFeeRupees !== undefined) {
    const p = spokenRupeesToPaise(raw.deliveryFeeRupees);
    if (p === null || p < 0) warn("Couldn't understand the delivery fee — please enter it", "deliveryFeePaise");
    else if (p > MAX_DELIVERY_FEE_PAISE) warn("Delivery fee looks too high — please check it", "deliveryFeePaise");
    else feePaise = p;
  }
  if (raw.fulfilmentMode) {
    draft.fulfilmentMode = raw.fulfilmentMode;
    filled.push("fulfilmentMode");
  } else {
    // A spoken delivery charge implies delivery; otherwise default to pickup.
    draft.fulfilmentMode = feePaise !== undefined && feePaise > 0 ? "DELIVERY" : "PICKUP";
  }
  if (feePaise !== undefined) {
    if (draft.fulfilmentMode === "PICKUP") {
      if (feePaise > 0) warn("A delivery fee was mentioned for a pickup-only drop — it was left out");
      draft.deliveryFeePaise = 0;
    } else {
      draft.deliveryFeePaise = feePaise;
      filled.push("deliveryFeePaise");
    }
  } else {
    draft.deliveryFeePaise = 0;
  }
  const windowWord = draft.fulfilmentMode === "DELIVERY" ? "delivery" : "pickup";

  // ── Fulfilment window
  const spokenStart = normaliseHm(raw.windowStart);
  let spokenEnd = normaliseHm(raw.windowEnd);
  if (raw.windowStart && !spokenStart) warn(`Couldn't understand the ${windowWord} start time — please check`, "fulfilmentStart");
  if (raw.windowEnd && !spokenEnd) warn(`Couldn't understand the ${windowWord} end time — please check`, "fulfilmentEnd");
  const start = spokenStart ?? (spokenEnd ? minToHm(Math.max(0, hmToMin(spokenEnd) - DEFAULT_WINDOW_MINUTES)) : DEFAULT_WINDOW_START);
  if (spokenStart && spokenEnd && hmToMin(spokenEnd) <= hmToMin(spokenStart)) {
    // "shaam 6 se 8" heard as 18:00–08:00: read the end in the afternoon/evening.
    const shifted = hmToMin(spokenEnd) + 720;
    if (hmToMin(spokenEnd) < 720 && shifted > hmToMin(spokenStart) && shifted < 1440) {
      spokenEnd = minToHm(shifted);
      warn(`Assumed ${windowWord} ends at ${hmLabel(spokenEnd)} — please check`, "fulfilmentEnd");
    }
  }
  const end =
    spokenEnd ??
    (spokenStart
      ? minToHm(Math.min(23 * 60 + 59, hmToMin(spokenStart) + DEFAULT_WINDOW_MINUTES))
      : DEFAULT_WINDOW_END);
  draft.fulfilmentStart = start;
  draft.fulfilmentEnd = end;
  if (spokenStart) filled.push("fulfilmentStart");
  if (spokenEnd) filled.push("fulfilmentEnd");
  if (hmToMin(end) <= hmToMin(start)) {
    warn(`The ${windowWord} window ends before it starts — please check the times`, "fulfilmentEnd");
  }

  // ── Order cut-off
  const cutoffTime = normaliseHm(raw.cutoffTime);
  if (raw.cutoffTime && !cutoffTime) warn("Couldn't understand the order cut-off time — please check", "closesAtTime");
  const cutoffDay = resolveDayRef(raw.cutoffDay, todayYmd, date);
  if (raw.cutoffDay && !cutoffDay) warn("Couldn't understand the order cut-off day — please check", "closesAtDate");
  if (cutoffTime || cutoffDay) {
    // Only a time: same day if it is before the window opens, else the evening before.
    const closesAtDate = cutoffDay ?? (cutoffTime && cutoffTime < start ? date : addDaysYmd(date, -1));
    const closesAtTime = cutoffTime ?? (closesAtDate < date ? DEFAULT_CUTOFF_TIME : LATE_CUTOFF_TIME);
    draft.closesAtDate = closesAtDate;
    draft.closesAtTime = closesAtTime;
    if (cutoffDay) filled.push("closesAtDate");
    if (cutoffTime) filled.push("closesAtTime");
  } else {
    const d = defaultCutoffFor(date, now);
    draft.closesAtDate = d.closesAtDate;
    draft.closesAtTime = d.closesAtTime;
  }

  // ── Orders open (optional; both parts or neither)
  const opensTime = normaliseHm(raw.opensTime);
  const opensDay = resolveDayRef(raw.opensDay, todayYmd, date);
  if (opensTime) {
    draft.opensAtDate = opensDay ?? todayYmd;
    draft.opensAtTime = opensTime;
    filled.push("opensAtDate", "opensAtTime");
  } else if (raw.opensTime || opensDay) {
    warn("Couldn't understand when orders open — please set it or leave it blank", "opensAtTime");
  }

  // ── Cross-field checks (IST wall clock → instants)
  const at = (ymd: string, hm: string): Date | null => {
    try {
      return istToUtc(ymd, hm);
    } catch {
      return null;
    }
  };
  const startAt = at(date, start);
  const closesAt = at(draft.closesAtDate, draft.closesAtTime);
  if (closesAt && startAt && closesAt > startAt) {
    warn(`Cut-off is after ${windowWord} starts — please check`, "closesAtTime");
  } else if (closesAt && closesAt <= now) {
    warn("The order cut-off has already passed — please move it later", "closesAtTime");
  }
  if (draft.opensAtDate && draft.opensAtTime) {
    const opensAt = at(draft.opensAtDate, draft.opensAtTime);
    if (opensAt && closesAt && opensAt >= closesAt) {
      warn("Orders open after they close — please check the times", "opensAtTime");
    }
  }

  // ── Items: re-anchor to THIS vendor's menu
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const items: DropDraftItem[] = [];
  const unmatched: DropDraftUnmatched[] = [];
  for (const line of raw.items) {
    const spokenName = line.spokenName.trim();
    const quantity =
      line.quantity !== undefined && line.quantity >= 1 ? clampInt(line.quantity, 1, DRAFT_MAX_QTY) : undefined;

    let menu = line.menuItemId ? byId.get(line.menuItemId) : undefined;
    let matchedByName = false;
    if (!menu && spokenName) {
      const rescued = rescueMatchFromTranscript(menuItems, spokenName);
      const hit = rescued.items[0];
      if (hit) {
        menu = byId.get(hit.menuItemId);
        matchedByName = Boolean(menu);
      }
    }
    if (!menu) {
      if (spokenName) unmatched.push(quantity !== undefined ? { spokenName, quantity } : { spokenName });
      continue;
    }
    if (seen.has(menu.id)) {
      warn(`${menu.name} was mentioned twice — kept the first one`);
      continue;
    }
    if (items.length >= MAX_ITEMS) {
      warn(`Only the first ${MAX_ITEMS} items were added`);
      break;
    }
    seen.add(menu.id);
    if (matchedByName) warn(`"${spokenName}" matched to ${menu.name} — please check`);

    let priceInPaise = menu.priceInPaise;
    if (line.priceRupees !== undefined) {
      const p = spokenRupeesToPaise(line.priceRupees);
      if (p !== null && p > 0) priceInPaise = p;
      else warn(`Couldn't understand the price for ${menu.name} — used the menu price`);
    }

    if (line.quantity !== undefined && line.quantity > DRAFT_MAX_QTY) {
      warn(`Quantity for ${menu.name} capped at ${DRAFT_MAX_QTY}`);
    }
    const maxQty = quantity ?? null;

    let perOrderLimit: number | null = null;
    if (line.perOrderLimit !== undefined && line.perOrderLimit >= 1) {
      perOrderLimit = clampInt(line.perOrderLimit, 1, DRAFT_MAX_PER_ORDER);
      if (maxQty !== null && perOrderLimit > maxQty) {
        perOrderLimit = maxQty;
        warn(`${menu.name}: ${PER_ORDER_OVER_MAX.toLowerCase()} — lowered to ${maxQty}`);
      }
    }

    items.push({
      menuItemId: menu.id,
      name: menu.name,
      priceInPaise,
      maxQty,
      perOrderLimit,
      sortOrder: items.length,
      ...(matchedByName ? { matchedByName: true } : {}),
    });
  }
  draft.items = items;
  draft.unmatched = unmatched;
  if (items.length > 0) filled.push("items");
  else warn("No menu items recognised — please pick items below", "items");

  // ── Final pass through the real save schema: anything it would reject and we
  // haven't already explained becomes a warning, never a failure.
  const check = dropUpsertSchema.safeParse({
    title: draft.title ?? "Draft",
    note: draft.note ?? null,
    date: draft.date,
    fulfilmentMode: draft.fulfilmentMode,
    fulfilmentStart: draft.fulfilmentStart,
    fulfilmentEnd: draft.fulfilmentEnd,
    pickupNote: draft.pickupNote ?? null,
    deliveryFeePaise: draft.deliveryFeePaise,
    opensAtDate: draft.opensAtDate ?? null,
    opensAtTime: draft.opensAtTime ?? null,
    closesAtDate: draft.closesAtDate,
    closesAtTime: draft.closesAtTime,
    showEverydayMenu: draft.showEverydayMenu,
    items: items.map(({ menuItemId, priceInPaise, maxQty, perOrderLimit, sortOrder }) => ({
      menuItemId,
      priceInPaise,
      maxQty,
      perOrderLimit,
      sortOrder,
    })),
  });
  if (!check.success) {
    for (const issue of check.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (warned.has(field)) continue;
      // Cut-off vs window and open vs close are reported above in plainer words.
      if (field === "closesAtTime" || field === "opensAtTime") continue;
      warn(issue.message, field);
    }
  }

  return draft;
}
