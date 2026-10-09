/**
 * Best-effort copy to the clipboard, client-side only.
 *
 * Tries the async Clipboard API first, then falls back to a hidden textarea +
 * `document.execCommand("copy")` for older iOS Safari / in-app browsers and
 * insecure contexts where `navigator.clipboard` is missing or throws. Resolves
 * `true` only when one of them reports success; never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Off-screen but still selectable; 16px avoids the iOS zoom-on-focus.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    ta.style.fontSize = "16px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
