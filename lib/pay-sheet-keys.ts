/**
 * Keyboard shortcuts on the POS "Collect payment" sheet (counter computers):
 * U = UPI, C = Cash, Enter = Mark as paid. Esc is the dialog's own close.
 * Pure so the rules can be unit-tested; the sheet passes the key event in.
 */

export type PaySheetShortcut = "upi" | "cash" | "pay";

export type PaySheetKeyEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True while an IME is composing (Hindi keyboards). */
  isComposing?: boolean;
  target: {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
  } | null;
};

/** Input types that only take a click, so letters typed on them are free. */
const NON_TEXT_INPUT_TYPES = new Set(["radio", "checkbox", "button", "submit", "reset"]);

function isTextEntry(target: PaySheetKeyEvent["target"]): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  return false;
}

/**
 * Enter on a button or link already activates that control, so it must keep
 * doing that (Exact, a note chip, Copy). Elsewhere it means "Mark as paid".
 */
function activatesOnEnter(target: PaySheetKeyEvent["target"]): boolean {
  const tag = target?.tagName?.toUpperCase();
  if (tag === "BUTTON" || tag === "A") return true;
  if (tag === "INPUT") return ["button", "submit", "reset"].includes((target?.type ?? "").toLowerCase());
  return false;
}

export function paySheetShortcut(e: PaySheetKeyEvent): PaySheetShortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  if (isTextEntry(e.target)) return null;
  if (e.key === "Enter") return activatesOnEnter(e.target) ? null : "pay";
  const k = e.key.toLowerCase();
  if (k === "u") return "upi";
  if (k === "c") return "cash";
  return null;
}
