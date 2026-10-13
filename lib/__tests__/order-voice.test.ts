import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimAnnouncement,
  NEW_ORDER_PHRASE,
  pushKindFromTag,
  pushMessageTag,
  shouldSpeakFor,
  speakNewOrder,
  SW_PUSH_MESSAGE,
} from "@/lib/order-voice";
import { newOrderPayload, paymentSubmittedPayload } from "@/lib/push";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pushKindFromTag", () => {
  it("reads the kind from the tags lib/push.ts sends", () => {
    const order = newOrderPayload({ billNumber: "AWZ-20261013-0001", totalPaise: 24000, itemCount: 2, dropId: null });
    const pay = paymentSubmittedPayload({ billNumber: "AWZ-20261013-0001", totalPaise: 24000, dropId: "d1" });
    expect(pushKindFromTag(order.tag)).toBe("order");
    expect(pushKindFromTag(pay.tag)).toBe("payment");
    expect(pushKindFromTag("test")).toBe("test");
  });

  it.each([["awaazos"], [""], ["orders"], [null], [undefined], [7]])("ignores %j", (tag) => {
    expect(pushKindFromTag(tag)).toBeNull();
  });
});

describe("pushMessageTag", () => {
  it("accepts only the service worker's push message", () => {
    expect(pushMessageTag({ type: SW_PUSH_MESSAGE, tag: "order-A" })).toBe("order-A");
    expect(pushMessageTag({ type: "something-else", tag: "order-A" })).toBeNull();
    expect(pushMessageTag({ type: SW_PUSH_MESSAGE })).toBeNull();
    expect(pushMessageTag("order-A")).toBeNull();
    expect(pushMessageTag(null)).toBeNull();
  });
});

describe("shouldSpeakFor", () => {
  it("speaks for a new order and a test alert, not for a payment claim", () => {
    expect(shouldSpeakFor("order")).toBe(true);
    expect(shouldSpeakFor("test")).toBe(true);
    expect(shouldSpeakFor("payment")).toBe(false);
  });
});

describe("speakNewOrder", () => {
  class FakeUtterance {
    lang = "";
    constructor(public text: string) {}
  }

  function stubSpeech(opts: { speaking?: boolean; active?: boolean } = {}) {
    const speak = vi.fn();
    vi.stubGlobal("window", {
      speechSynthesis: { speak, speaking: opts.speaking ?? false, pending: false },
      SpeechSynthesisUtterance: FakeUtterance,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: opts.active ?? true } });
    return speak;
  }

  it("says the fixed phrase in Indian English", () => {
    const speak = stubSpeech();
    expect(speakNewOrder()).toBe(true);
    const said = speak.mock.calls[0]![0] as FakeUtterance;
    expect(said.text).toBe(NEW_ORDER_PHRASE);
    expect(said.text).toBe("New order received from customer");
    expect(said.lang).toBe("en-IN");
  });

  it("announces a burst once instead of queueing repeats", () => {
    const speak = stubSpeech({ speaking: true });
    expect(speakNewOrder()).toBe(true);
    expect(speak).not.toHaveBeenCalled();
  });

  it("reports false before the page has been tapped, so the caller can fall back", () => {
    const speak = stubSpeech({ active: false });
    expect(speakNewOrder()).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });

  it("reports false where there is no speech support", () => {
    vi.stubGlobal("window", {});
    expect(speakNewOrder()).toBe(false);
  });
});

describe("claimAnnouncement", () => {
  it("lets every tab speak when Web Locks is missing", async () => {
    vi.stubGlobal("navigator", {});
    await expect(claimAnnouncement("order-A")).resolves.toBe(true);
  });

  it("gives the announcement to the tab that gets the lock", async () => {
    vi.stubGlobal("window", { setTimeout: (fn: () => void) => fn() });
    const request = vi
      .fn()
      .mockImplementationOnce(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb({}))
      .mockImplementationOnce(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null));
    vi.stubGlobal("navigator", { locks: { request } });
    await expect(claimAnnouncement("order-A")).resolves.toBe(true);
    await expect(claimAnnouncement("order-A")).resolves.toBe(false);
    expect(request.mock.calls[0]![0]).toBe("awz-order-voice:order-A");
    expect(request.mock.calls[0]![1]).toEqual({ ifAvailable: true });
  });
});
