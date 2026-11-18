/**
 * Enter on a text field that should act ("Add area", "Save"), safe for IME keyboards.
 *
 * On a Hindi or Kannada transliteration keyboard (and Japanese, Chinese, Korean IMEs),
 * the Enter that confirms a composed word arrives as a keydown with key "Enter". Acting
 * on it would save a half-typed value. `isComposing` flags it in Chrome and Firefox;
 * Safari can reset `isComposing` before the keydown handler runs, but still reports
 * keyCode 229 (VK_PROCESSKEY), so both are checked. 229 only matters under key "Enter",
 * so a mobile keyboard that reports 229 for ordinary letters is unaffected.
 *
 * Pure: pass a React keyboard event (or anything shaped like one).
 */
export type EnterKeyEvent = {
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
};

export function isCommitEnter(e: EnterKeyEvent): boolean {
  // keyCode is deprecated, but it is the only signal Safari's out-of-order event leaves.
  return e.key === "Enter" && !e.nativeEvent?.isComposing && e.keyCode !== 229;
}
