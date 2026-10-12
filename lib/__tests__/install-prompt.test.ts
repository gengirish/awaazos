import { describe, expect, it } from "vitest";

import { detectInstallMode, isInAppBrowser, type InstallEnv } from "@/lib/install-prompt";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 337.0.0.0.77 Android",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.2.24.92 (iPhone15,2; iOS 17_5; en_IN; en; scale=3.00; 1179x2556; 612345678)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.31.105;FBBV/612345678;FBDV/iPhone15,2]",
  iphoneBareWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
} as const;

function env(over: Partial<InstallEnv>): InstallEnv {
  return { userAgent: UA.androidChrome, maxTouchPoints: 5, standalone: false, canPrompt: false, ...over };
}

describe("isInAppBrowser", () => {
  it.each([
    ["Instagram on Android", UA.androidInstagram],
    ["a bare Android WebView", UA.androidWebView],
    ["Instagram on iPhone", UA.iphoneInstagram],
    ["Facebook on iPhone", UA.iphoneFacebook],
    ["an unnamed iPhone WebView", UA.iphoneBareWebView],
  ])("%s", (_label, ua) => {
    expect(isInAppBrowser(ua, 5)).toBe(true);
  });

  it.each([
    ["Chrome on Android", UA.androidChrome, 5],
    ["Safari on iPhone", UA.iphoneSafari, 5],
    ["Chrome on iPhone", UA.iphoneChrome, 5],
    ["Safari on iPad in desktop mode", UA.ipadDesktopMode, 5],
    ["Chrome on Windows", UA.desktopChrome, 0],
    ["Firefox on Windows", UA.desktopFirefox, 0],
  ])("not %s", (_label, ua, touch) => {
    expect(isInAppBrowser(ua, touch)).toBe(false);
  });
});

describe("detectInstallMode", () => {
  it("offers the browser's install dialog once Chromium has fired beforeinstallprompt", () => {
    expect(detectInstallMode(env({ canPrompt: true }))).toBe("prompt");
    expect(detectInstallMode(env({ userAgent: UA.desktopChrome, maxTouchPoints: 0, canPrompt: true }))).toBe("prompt");
  });

  it("offers nothing on Chromium until the browser says the app is installable", () => {
    expect(detectInstallMode(env({ canPrompt: false }))).toBe("none");
  });

  it("gives iPhone and iPad the Add-to-Home-Screen steps, in any real browser", () => {
    expect(detectInstallMode(env({ userAgent: UA.iphoneSafari }))).toBe("ios");
    expect(detectInstallMode(env({ userAgent: UA.iphoneChrome }))).toBe("ios");
    expect(detectInstallMode(env({ userAgent: UA.ipadDesktopMode }))).toBe("ios");
  });

  it("does not mistake a Mac for an iPad", () => {
    expect(detectInstallMode(env({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 0 }))).toBe("none");
  });

  it("never offers a button inside an in-app browser, even if one could be wired", () => {
    expect(detectInstallMode(env({ userAgent: UA.androidInstagram, canPrompt: true }))).toBe("in-app");
    expect(detectInstallMode(env({ userAgent: UA.iphoneInstagram }))).toBe("in-app");
    expect(detectInstallMode(env({ userAgent: UA.iphoneFacebook }))).toBe("in-app");
  });

  it("shows nothing once the app is running from the Home Screen", () => {
    expect(detectInstallMode(env({ standalone: true, canPrompt: true }))).toBe("none");
    expect(detectInstallMode(env({ userAgent: UA.iphoneSafari, standalone: true }))).toBe("none");
    expect(detectInstallMode(env({ userAgent: UA.androidInstagram, standalone: true }))).toBe("none");
  });

  it("shows nothing where there is no install path at all", () => {
    expect(detectInstallMode(env({ userAgent: UA.desktopFirefox, maxTouchPoints: 0 }))).toBe("none");
  });
});
