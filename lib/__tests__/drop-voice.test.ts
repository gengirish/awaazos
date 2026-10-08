import { describe, expect, it } from "vitest";

import {
  NO_VOICE_MARKS,
  mergeDropDraft,
  unmarkField,
  unmarkItem,
  voiceSummary,
  type DropFormSnapshot,
  type VoiceDropDraftInput,
} from "@/lib/drop-voice";

const MENU = [
  { id: "laddu", priceInPaise: 12_000 },
  { id: "thepla", priceInPaise: 4_000 },
  { id: "chakli", priceInPaise: 8_000 },
];

function snapshot(): DropFormSnapshot {
  return {
    form: {
      title: "",
      note: "",
      date: "2026-10-10",
      fulfilmentMode: "DELIVERY",
      fulfilmentStart: "17:00",
      fulfilmentEnd: "20:00",
      deliveryFee: "0",
      pickupNote: "",
      closesAtDate: "2026-10-09",
      closesAtTime: "21:00",
      useOpensAt: false,
      opensAtDate: "2026-10-09",
      opensAtTime: "09:00",
      showEverydayMenu: false,
    },
    rows: {
      laddu: { selected: false, price: "120", maxQty: "", perOrderLimit: "" },
      thepla: { selected: false, price: "40", maxQty: "", perOrderLimit: "" },
      chakli: { selected: true, price: "75", maxQty: "10", perOrderLimit: "2" },
    },
    order: ["chakli", "laddu", "thepla"],
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe("mergeDropDraft — fields", () => {
  it("applies only the fields the draft carries and leaves the rest alone", () => {
    const prev = snapshot();
    const { next, marks, fieldCount, dishCount } = mergeDropDraft(
      prev,
      { title: "Ragi specials", fulfilmentMode: "PICKUP", fulfilmentStart: "18:00", fulfilmentEnd: "20:00" },
      MENU,
    );
    expect(next.form).toEqual({
      ...prev.form,
      title: "Ragi specials",
      fulfilmentMode: "PICKUP",
      fulfilmentStart: "18:00",
      fulfilmentEnd: "20:00",
    });
    expect(marks.fields.sort()).toEqual(["fulfilmentEnd", "fulfilmentMode", "fulfilmentStart", "title"]);
    expect(fieldCount).toBe(4);
    expect(dishCount).toBe(0);
  });

  it("never clears a field: null / empty strings are treated as not said", () => {
    const prev = snapshot();
    prev.form.note = "Eggless";
    const { next, marks } = mergeDropDraft(prev, { note: null, title: "   ", pickupNote: undefined }, MENU);
    expect(next.form).toEqual(prev.form);
    expect(marks).toEqual({ fields: [], items: [] });
  });

  it("converts the delivery fee from paise to a rupee input", () => {
    const { next, marks } = mergeDropDraft(snapshot(), { deliveryFeePaise: 3_050 }, MENU);
    expect(next.form.deliveryFee).toBe("30.5");
    expect(marks.fields).toEqual(["deliveryFee"]);
  });

  it("turns on the delayed-opening toggle when an opening time is heard", () => {
    const { next, marks } = mergeDropDraft(snapshot(), { opensAtTime: "10:00" }, MENU);
    expect(next.form.useOpensAt).toBe(true);
    expect(next.form.opensAtTime).toBe("10:00");
    expect(marks.fields).toContain("opensAtTime");
  });

  it("moves an unspoken cut-off date along with a new cooking day", () => {
    const { next } = mergeDropDraft(snapshot(), { date: "2026-10-12" }, MENU);
    expect(next.form.date).toBe("2026-10-12");
    expect(next.form.closesAtDate).toBe("2026-10-11");
  });

  it("keeps a cut-off date the vendor set by hand", () => {
    const { next } = mergeDropDraft(snapshot(), { date: "2026-10-12" }, MENU, {
      closesAtDate: true,
      opensAtDate: false,
    });
    expect(next.form.closesAtDate).toBe("2026-10-09");
  });

  it("uses a spoken cut-off over the shifted one", () => {
    const { next, marks } = mergeDropDraft(
      snapshot(),
      { date: "2026-10-12", closesAtDate: "2026-10-12", closesAtTime: "16:00" },
      MENU,
    );
    expect(next.form.closesAtDate).toBe("2026-10-12");
    expect(next.form.closesAtTime).toBe("16:00");
    expect(marks.fields).toEqual(expect.arrayContaining(["date", "closesAtDate", "closesAtTime"]));
  });

  it("ignores an invalid date instead of breaking the form", () => {
    const { next, marks } = mergeDropDraft(snapshot(), { date: "2026-02-30x" }, MENU);
    expect(next.form.date).toBe("2026-10-10");
    expect(marks.fields).toEqual([]);
  });

  it("applies only fields listed in `filled`; inferred defaults leave the form alone", () => {
    const before = snapshot();
    const { next, marks, fieldCount } = mergeDropDraft(
      before,
      { title: "Diwali box", closesAtTime: "16:00", filled: ["title"] },
      MENU,
    );
    // closesAtTime was inferred by the API, not said — keep the form's value.
    expect(next.form.closesAtTime).toBe(before.form.closesAtTime);
    expect(next.form.title).toBe("Diwali box");
    expect(marks.fields).toEqual(["title"]);
    expect(fieldCount).toBe(1);
  });

  it("on an existing drop, saying only dishes keeps its mode, window and delivery fee", () => {
    const before = snapshot();
    before.form = {
      ...before.form,
      fulfilmentMode: "DELIVERY",
      fulfilmentStart: "18:30",
      fulfilmentEnd: "21:00",
      deliveryFee: "40",
    };
    const { next } = mergeDropDraft(
      before,
      {
        // The API fills defaults for unspoken fields…
        fulfilmentMode: "PICKUP",
        fulfilmentStart: "17:00",
        fulfilmentEnd: "20:00",
        deliveryFeePaise: 0,
        showEverydayMenu: false,
        items: [{ menuItemId: "laddu", priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 }],
        // …but only the dishes were actually said.
        filled: ["items"],
      },
      MENU,
    );
    expect(next.form.fulfilmentMode).toBe("DELIVERY");
    expect(next.form.fulfilmentStart).toBe("18:30");
    expect(next.form.fulfilmentEnd).toBe("21:00");
    expect(next.form.deliveryFee).toBe("40");
    expect(next.rows.laddu.selected).toBe(true);
  });
});

describe("mergeDropDraft — items", () => {
  it("replaces the selection with the voice dishes, in spoken order", () => {
    const { next, marks, dishCount } = mergeDropDraft(
      snapshot(),
      {
        items: [
          { menuItemId: "thepla", priceInPaise: 4_500, maxQty: 15, perOrderLimit: null, sortOrder: 1 },
          { menuItemId: "laddu", priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 },
        ],
      },
      MENU,
    );
    expect(next.rows.chakli.selected).toBe(false);
    expect(next.rows.laddu).toEqual({ selected: true, price: "150", maxQty: "20", perOrderLimit: "" });
    expect(next.rows.thepla).toEqual({ selected: true, price: "45", maxQty: "15", perOrderLimit: "" });
    expect(next.order).toEqual(["laddu", "thepla", "chakli"]);
    expect(marks.items).toEqual(["laddu", "thepla"]);
    expect(dishCount).toBe(2);
  });

  it("keeps the vendor's per-item edits for the same dish unless voice gave that value", () => {
    const { next } = mergeDropDraft(
      snapshot(),
      { items: [{ menuItemId: "chakli", priceInPaise: null, maxQty: 12, perOrderLimit: null, sortOrder: 0 }] },
      MENU,
    );
    // Price 75 and per-order 2 were the vendor's edits; voice only said "12".
    expect(next.rows.chakli).toEqual({ selected: true, price: "75", maxQty: "12", perOrderLimit: "2" });
  });

  it("leaves the item selection alone when the draft has no dishes", () => {
    const prev = snapshot();
    const { next, marks } = mergeDropDraft(prev, { title: "x", items: [] }, MENU);
    expect(next.rows).toEqual(prev.rows);
    expect(next.order).toEqual(prev.order);
    expect(marks.items).toEqual([]);
  });

  it("drops ids that aren't on this vendor's menu and reports them", () => {
    const prev = snapshot();
    const { next, unknownItemIds, dishCount } = mergeDropDraft(
      prev,
      { items: [{ menuItemId: "someone-elses-item", priceInPaise: 100, maxQty: null, perOrderLimit: null, sortOrder: 0 }] },
      MENU,
    );
    expect(unknownItemIds).toEqual(["someone-elses-item"]);
    expect(dishCount).toBe(0);
    expect(next.rows).toEqual(prev.rows);
    expect(next.rows["someone-elses-item"]).toBeUndefined();
  });

  it("ignores non-positive or fractional counts from the model", () => {
    const { next } = mergeDropDraft(
      snapshot(),
      { items: [{ menuItemId: "laddu", priceInPaise: 0, maxQty: 2.5, perOrderLimit: -1, sortOrder: 0 }] },
      MENU,
    );
    expect(next.rows.laddu).toEqual({ selected: true, price: "120", maxQty: "", perOrderLimit: "" });
  });
});

describe("mergeDropDraft — undo snapshot", () => {
  it("never mutates the snapshot it was given, so restoring it undoes everything", () => {
    const prev = deepFreeze(snapshot());
    const before = JSON.stringify(prev);
    const draft: VoiceDropDraftInput = {
      title: "Ragi day",
      date: "2026-10-12",
      deliveryFeePaise: 2_000,
      items: [{ menuItemId: "laddu", priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 }],
    };
    const { next } = mergeDropDraft(prev, draft, MENU);
    expect(JSON.stringify(prev)).toBe(before);
    expect(next).not.toBe(prev);
    expect(next.form).not.toEqual(prev.form);
    // Undo = put the snapshot back.
    expect(JSON.parse(before)).toEqual(snapshot());
  });

  it("applying the same draft twice gives the same form (no accumulation)", () => {
    const draft: VoiceDropDraftInput = {
      title: "Ragi day",
      items: [{ menuItemId: "laddu", priceInPaise: 15_000, maxQty: 20, perOrderLimit: null, sortOrder: 0 }],
    };
    const once = mergeDropDraft(snapshot(), draft, MENU).next;
    const twice = mergeDropDraft(once, draft, MENU).next;
    expect(twice).toEqual(once);
  });
});

describe("voice marks + summary", () => {
  it("unmarks a field or dish once the vendor edits it", () => {
    const marks = { fields: ["title" as const, "date" as const], items: ["laddu"] };
    expect(unmarkField(marks, "title")).toEqual({ fields: ["date"], items: ["laddu"] });
    expect(unmarkField(marks, "note")).toBe(marks);
    expect(unmarkItem(marks, "laddu")).toEqual({ fields: ["title", "date"], items: [] });
    expect(unmarkItem(NO_VOICE_MARKS, "x")).toBe(NO_VOICE_MARKS);
  });

  it("summarises what was filled", () => {
    expect(voiceSummary(6, 3)).toBe("Filled 6 fields and 3 dishes — check and save");
    expect(voiceSummary(1, 1)).toBe("Filled 1 field and 1 dish — check and save");
    expect(voiceSummary(0, 2)).toBe("Filled 2 dishes — check and save");
    expect(voiceSummary(0, 0)).toMatch(/fill the form below/);
  });
});
