/**
 * Cookie-consent answer, shared by the banner (client) and the root layout
 * (server). Pure constants — safe to import from either side.
 */

/** localStorage key holding "accepted" | "declined". */
export const COOKIE_PREF_KEY = "awz_cookie_pref_v1";

/**
 * Inline <head> script: if this browser already answered the banner, mark
 * <html data-cookie-pref> before first paint so the server-rendered banner
 * never flashes (app/globals.css hides it; CookieConsentBanner then unmounts).
 *
 * A fixed string with no interpolated user or request data. It has to be a
 * real inline script — `next/script` runs after the first paint.
 */
export const COOKIE_PREF_BOOT_SCRIPT =
  `try{var p=localStorage.getItem(${JSON.stringify(COOKIE_PREF_KEY)});` +
  `if(p==="accepted"||p==="declined")document.documentElement.setAttribute("data-cookie-pref",p)}catch(e){}`;
