/**
 * The product's name and tagline: the one place they are spelled.
 *
 * Every display string (page titles, copy, emails, WhatsApp texts, share images,
 * the installed app's name) reads these, so a rename is a change here.
 * `lib/__tests__/brand.test.ts` fails if the former name comes back as a string
 * anywhere in app code, and checks the few files that can't import this module
 * (public/sw.js, public/offline.html, content/admin-nudges/*.txt) carry
 * BRAND_NAME.
 *
 * Names only. Identifiers that devices and other systems already hold keep the
 * old spelling on purpose (docs/REBRAND_AWAAZDO_PLAN.md, "Keep"): the
 * `awaazos-pos` IndexedDB store, `awz_*` cookies and `awz:` storage keys,
 * `AWZ-` bill numbers, `awaazos:` page events, the manifest `id`, and service,
 * package and deploy names.
 *
 * Pure and client-safe.
 */

export const BRAND_NAME = "AwaazDo";

/** "Make it. Tell people. Sell it." */
export const BRAND_TAGLINE = "Banao. Batao. Becho.";

/** Email and message sign-off. */
export const BRAND_SIGNOFF = `${BRAND_NAME} — ${BRAND_TAGLINE}`;

/**
 * The name sellers signed up under. Legal pages say "formerly …" so terms
 * accepted under it still read as the same service. Nothing else uses it.
 */
export const BRAND_FORMER_NAME = "AwaazOS";
