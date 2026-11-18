import { describe, expect, it } from "vitest";

import { isCommitEnter } from "../ime-enter";

describe("isCommitEnter", () => {
  it("acts on a plain Enter", () => {
    expect(isCommitEnter({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: false } })).toBe(true);
  });

  it("ignores the Enter that confirms an IME word (Chrome, Firefox)", () => {
    expect(isCommitEnter({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: true } })).toBe(false);
  });

  it("ignores Safari's confirming Enter, where isComposing is already false", () => {
    expect(isCommitEnter({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: false } })).toBe(false);
  });

  it("ignores other keys, including 229 letters from mobile keyboards", () => {
    expect(isCommitEnter({ key: "a", keyCode: 229 })).toBe(false);
    expect(isCommitEnter({ key: "Escape", keyCode: 27 })).toBe(false);
  });
});
