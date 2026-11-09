import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rbac", () => ({ AuthError: class extends Error {} }));

import { isPushServiceEndpoint, subscribeSchema } from "@/lib/push-devices";

const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

describe("isPushServiceEndpoint", () => {
  it("accepts the browsers' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://android.googleapis.com/gcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-pn1p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses any other host, port, scheme or credentials", () => {
    for (const endpoint of [
      "https://x.example/push",
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://evilpush.services.mozilla.com.example/abc",
      "https://notify.windows.com.evil.example/abc",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it("is what subscribeSchema enforces", () => {
    expect(subscribeSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }).success).toBe(true);
    expect(subscribeSchema.safeParse({ endpoint: "https://x.example/push", keys }).success).toBe(false);
  });
});
