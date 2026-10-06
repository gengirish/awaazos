import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  detectPushSupport,
  deviceLabel,
  endpointHash,
  isIOS,
  safeNotificationPath,
  urlBase64ToUint8Array,
  type PushEnv,
} from "@/lib/push-client";

const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01]);
    const b64url = Buffer.from(bytes).toString("base64url");
    expect(b64url).toMatch(/[-_]/);
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(bytes));
  });

  it("decodes a 65-byte uncompressed P-256 VAPID key", () => {
    const key = Buffer.alloc(65, 7);
    key[0] = 0x04;
    const out = urlBase64ToUint8Array(key.toString("base64url"));
    expect(out).toHaveLength(65);
    expect(out[0]).toBe(0x04);
  });
});

describe("deviceLabel", () => {
  it.each([
    [UA.chromeAndroid, 5, "Chrome on Android"],
    [UA.samsung, 5, "Samsung Internet on Android"],
    [UA.safariIphone, 5, "Safari on iPhone"],
    [UA.chromeIphone, 5, "Chrome on iPhone"],
    [UA.ipadDesktopMode, 5, "Safari on iPad"],
    [UA.ipadDesktopMode, 0, "Safari on Mac"],
    [UA.edgeWindows, 0, "Edge on Windows"],
    [UA.firefoxWindows, 0, "Firefox on Windows"],
    [UA.chromeMac, 0, "Chrome on Mac"],
    ["", 0, "Browser on this device"],
  ])("%s → %s", (ua, touch, label) => {
    expect(deviceLabel(ua, touch)).toBe(label);
  });
});

describe("detectPushSupport", () => {
  const base: PushEnv = {
    vapidKey: "BKey",
    userAgent: UA.chromeAndroid,
    maxTouchPoints: 5,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    standalone: false,
  };

  it("supported on Chrome Android", () => {
    expect(detectPushSupport(base)).toBe("supported");
  });

  it("not-configured without a VAPID key, before anything else", () => {
    expect(detectPushSupport({ ...base, vapidKey: "", hasPushManager: false })).toBe("not-configured");
  });

  it("iPhone Safari outside the Home Screen needs install", () => {
    expect(
      detectPushSupport({ ...base, userAgent: UA.safariIphone, hasPushManager: false, hasNotification: false }),
    ).toBe("ios-needs-install");
  });

  it("iPad in desktop mode outside the Home Screen needs install", () => {
    expect(detectPushSupport({ ...base, userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toBe(
      "ios-needs-install",
    );
  });

  it("iPhone installed to the Home Screen is supported", () => {
    expect(detectPushSupport({ ...base, userAgent: UA.safariIphone, standalone: true })).toBe("supported");
  });

  it("old iOS standalone without PushManager is unsupported", () => {
    expect(
      detectPushSupport({ ...base, userAgent: UA.safariIphone, standalone: true, hasPushManager: false }),
    ).toBe("unsupported");
  });

  it.each(["hasServiceWorker", "hasPushManager", "hasNotification"] as const)("unsupported without %s", (k) => {
    expect(detectPushSupport({ ...base, [k]: false })).toBe("unsupported");
  });

  it("desktop Mac Safari (no touch) is not treated as iOS", () => {
    expect(isIOS(UA.ipadDesktopMode, 0)).toBe(false);
    expect(detectPushSupport({ ...base, userAgent: UA.ipadDesktopMode, maxTouchPoints: 0 })).toBe("supported");
  });
});

describe("safeNotificationPath", () => {
  const origin = "https://awaazos.vercel.app";
  it.each([
    ["/orders", "/orders"],
    ["/drops/abc123", "/drops/abc123"],
    ["/orders?x=1#top", "/orders?x=1#top"],
    ["  /orders  ", "/orders"],
    ["/../settings", "/settings"],
    ["https://evil.example/orders", "/orders"],
    ["//evil.example/orders", "/orders"],
    ["/\\evil.example", "/orders"],
    ["javascript:alert(1)", "/orders"],
    ["orders", "/orders"],
    ["", "/orders"],
    [undefined, "/orders"],
    [42, "/orders"],
  ])("%j → %s", (raw, expected) => {
    expect(safeNotificationPath(raw, origin)).toBe(expected);
  });
});

describe("endpointHash", () => {
  it("is SHA-256 hex of the endpoint, same as the server", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";
    expect(await endpointHash(endpoint)).toBe(createHash("sha256").update(endpoint).digest("hex"));
  });
});
