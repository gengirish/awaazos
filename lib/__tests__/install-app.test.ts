import { describe, expect, it } from "vitest";

import { detectInstallGuide, INSTALL_STEPS, isInAppBrowser } from "@/lib/install-app";

const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android",
  instagramIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone14,5; iOS 17_5; en_IN)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0.0;]",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

describe("isInAppBrowser", () => {
  it("spots Instagram and Facebook webviews", () => {
    expect(isInAppBrowser(UA.instagramAndroid)).toBe(true);
    expect(isInAppBrowser(UA.instagramIphone)).toBe(true);
    expect(isInAppBrowser(UA.facebookAndroid)).toBe(true);
  });

  it("leaves real browsers alone", () => {
    expect(isInAppBrowser(UA.chromeAndroid)).toBe(false);
    expect(isInAppBrowser(UA.safariIphone)).toBe(false);
  });
});

describe("detectInstallGuide", () => {
  it("sends in-app browsers out to a real browser, on either OS", () => {
    expect(detectInstallGuide(UA.instagramAndroid, 5)).toBe("in-app-browser");
    expect(detectInstallGuide(UA.instagramIphone, 5)).toBe("in-app-browser");
  });

  it("iPhone and desktop-mode iPad get the Share menu steps", () => {
    expect(detectInstallGuide(UA.safariIphone, 5)).toBe("ios");
    expect(detectInstallGuide(UA.ipadDesktopMode, 5)).toBe("ios");
  });

  it("a Mac without touch is a desktop, not an iPad", () => {
    expect(detectInstallGuide(UA.ipadDesktopMode, 0)).toBe("desktop");
  });

  it("Android and desktop browsers", () => {
    expect(detectInstallGuide(UA.chromeAndroid, 5)).toBe("android");
    expect(detectInstallGuide(UA.firefoxWindows, 0)).toBe("desktop");
  });
});

describe("INSTALL_STEPS", () => {
  it("has an intro and steps for every guide", () => {
    for (const guide of Object.values(INSTALL_STEPS)) {
      expect(guide.intro.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThanOrEqual(2);
    }
  });
});
