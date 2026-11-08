import { describe, expect, it } from "vitest";

import { paySheetShortcut } from "@/lib/pay-sheet-keys";

const on = (tagName: string, type?: string) => ({ tagName, type });

describe("paySheetShortcut", () => {
  it("maps U / C / Enter on the sheet itself", () => {
    expect(paySheetShortcut({ key: "u", target: on("DIV") })).toBe("upi");
    expect(paySheetShortcut({ key: "U", target: on("DIV") })).toBe("upi");
    expect(paySheetShortcut({ key: "c", target: on("DIV") })).toBe("cash");
    expect(paySheetShortcut({ key: "Enter", target: on("DIV") })).toBe("pay");
    expect(paySheetShortcut({ key: "x", target: on("DIV") })).toBeNull();
  });

  it("ignores keys typed into a text field", () => {
    expect(paySheetShortcut({ key: "c", target: on("INPUT", "text") })).toBeNull();
    expect(paySheetShortcut({ key: "u", target: on("INPUT") })).toBeNull();
    expect(paySheetShortcut({ key: "Enter", target: on("INPUT", "text") })).toBeNull();
    expect(paySheetShortcut({ key: "u", target: on("TEXTAREA") })).toBeNull();
    expect(paySheetShortcut({ key: "u", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
  });

  it("works on the mode radios, which take no text", () => {
    expect(paySheetShortcut({ key: "c", target: on("INPUT", "radio") })).toBe("cash");
    expect(paySheetShortcut({ key: "Enter", target: on("INPUT", "radio") })).toBe("pay");
  });

  it("leaves Enter to a focused button or link", () => {
    expect(paySheetShortcut({ key: "Enter", target: on("BUTTON") })).toBeNull();
    expect(paySheetShortcut({ key: "Enter", target: on("A") })).toBeNull();
    // Letters still switch mode from a button.
    expect(paySheetShortcut({ key: "u", target: on("BUTTON") })).toBe("upi");
  });

  it("ignores modified keys and IME composition", () => {
    expect(paySheetShortcut({ key: "c", ctrlKey: true, target: on("DIV") })).toBeNull();
    expect(paySheetShortcut({ key: "c", metaKey: true, target: on("DIV") })).toBeNull();
    expect(paySheetShortcut({ key: "u", altKey: true, target: on("DIV") })).toBeNull();
    expect(paySheetShortcut({ key: "Enter", isComposing: true, target: on("DIV") })).toBeNull();
    expect(paySheetShortcut({ key: "u", target: null })).toBe("upi");
  });
});
