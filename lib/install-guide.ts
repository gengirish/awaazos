import { INSTALL_COPY } from "@/lib/install-prompt";

/**
 * The picture-led "Add to Home Screen" dialog on iPhone and iPad:
 * @khmyznikov/pwa-install, a web component that also walks someone inside
 * Instagram's browser out to Safari (copy link, then open it there).
 *
 * Apple only. Chromium has a one-tap prompt (hooks/useInstallPrompt.ts) that
 * this must not take over, and the library's Android sheet has no close button.
 * Which device gets it is decided by the store, not by the library; this file
 * only opens the dialog.
 *
 * It weighs about 45 kB gzipped, so it loads on the first tap and never on page
 * load. Until then, or if that load fails offline, the written steps beside the
 * button still say what to do.
 */

type GuideElement = HTMLElement & {
  showDialog: (forced?: boolean) => void;
  hideDialog: () => void;
  updateComplete: Promise<boolean>;
};

/**
 * The library defaults to /manifest.json, and refuses to open unless this
 * matches the page's own link: the seller app's here, a store's own on its
 * pages (lib/store-app.ts).
 */
const MANIFEST_URL = "/manifest.webmanifest";

export type InstallGuideOptions = {
  /** The page's manifest link. Default: the seller app's. */
  manifestUrl?: string;
  /** The line under the app's name in the dialog. Default: INSTALL_COPY.prompt. */
  description?: string;
};

/** Set on every open: a client-side navigation can move between the seller app and a store. */
function applyOptions(element: GuideElement, options: InstallGuideOptions): void {
  element.setAttribute("manifest-url", options.manifestUrl ?? MANIFEST_URL);
  element.setAttribute("install-description", options.description ?? INSTALL_COPY.prompt);
}

/**
 * Its close button is 26 px (42 px from iOS 26). `button.close` is one step more
 * specific than the library's rules: they are adopted stylesheets, which beat a
 * <style> tag on a tie. The version is pinned in package.json: re-check this
 * selector when bumping it.
 */
const CLOSE_TARGET_CSS =
  "#pwa-install-element .install-dialog.apple.dialog-body button.close{height:44px;min-width:44px}";

let mounting: Promise<GuideElement> | null = null;
let returnFocusTo: HTMLElement | null = null;

function afterClose(): void {
  document.removeEventListener("keydown", onKeyDown);
  returnFocusTo?.focus();
  returnFocusTo = null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  void mounting?.then((element) => element.hideDialog());
  afterClose();
}

function mount(options: InstallGuideOptions): Promise<GuideElement> {
  mounting ??= import("@khmyznikov/pwa-install")
    .then(
      () =>
        new Promise<GuideElement>((resolve) => {
          const element = document.createElement("pwa-install") as GuideElement;
          applyOptions(element, options);
          element.setAttribute("manual-apple", "");
          // Straight to the steps; the manifest has no screenshots to offer first.
          element.setAttribute("manual-how-to", "");
          element.setAttribute("disable-screenshots", "");
          // Fired when the close button is tapped.
          element.addEventListener("pwa-user-choice-result-event", afterClose);
          // It hides itself while starting up (manual-apple), so showDialog() has to wait for this.
          element.addEventListener("pwa-install-available-event", () => resolve(element), { once: true });
          document.body.append(element);
        }),
    )
    .catch((error: unknown) => {
      mounting = null; // Offline: a later tap tries again.
      throw error;
    });
  return mounting;
}

/** Open the dialog. Call only from a tap. Never throws: the written steps are the fallback. */
export async function openInstallGuide(options: InstallGuideOptions = {}): Promise<void> {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    const element = await mount(options);
    applyOptions(element, options);
    element.showDialog(true);
    await element.updateComplete;

    const root = element.shadowRoot;
    if (root && !root.querySelector("style[data-awz]")) {
      const style = document.createElement("style");
      style.dataset.awz = "";
      style.textContent = CLOSE_TARGET_CSS;
      root.append(style);
    }
    // The element sits at the end of <body>: without this, a screen reader
    // user would not know the dialog had opened. Not modal, so no focus trap.
    returnFocusTo = opener;
    document.addEventListener("keydown", onKeyDown);
    root?.querySelector<HTMLElement>("button.close")?.focus();
  } catch {
    // Chunk failed to load: nothing opens, and the steps are already on screen.
  }
}
