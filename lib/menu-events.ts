/**
 * Fired on `window` after menu rows are saved outside the list showing them
 * (VoiceMenuPanel), so that list re-reads them. Its own module so a listener
 * (the menu screen, first-run setup) doesn't pull in the component that fires it.
 */
export const MENU_CHANGED_EVENT = "awaazos:menu-changed";
