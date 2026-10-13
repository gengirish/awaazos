import { afterEach, describe, expect, it, vi } from "vitest";

import {
  billFromOrderTag,
  claimAnnouncement,
  fetchOrderFirstName,
  NEW_ORDER_PHRASE,
  newOrderPhrase,
  ORDER_SOUND_PREF_KEY,
  pushKindFromTag,
  pushMessageTag,
  readOrderSoundPref,
  shouldSpeakFor,
  speakNewOrder,
  spokenName,
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

describe("the push never carries the name", () => {
  it("a new-order payload has the bill number and nothing about the buyer", () => {
    const order = newOrderPayload({ billNumber: "AWZ-20261013-0001", totalPaise: 24000, itemCount: 2, dropId: null });
    expect(Object.keys(order).sort()).toEqual(["body", "tag", "title", "url"]);
    expect(billFromOrderTag(order.tag)).toBe("AWZ-20261013-0001");
  });

  it("only a new-order tag yields a bill", () => {
    expect(billFromOrderTag("pay-AWZ-20261013-0001")).toBeNull();
    expect(billFromOrderTag("test")).toBeNull();
    expect(billFromOrderTag("order-")).toBeNull();
  });
});

describe("spokenName / newOrderPhrase", () => {
  it.each([
    ["Priya Sharma", "Priya"],
    ["  ravi  ", "ravi"],
    ["प्रिया शर्मा", "प्रिया"],
    ["D'Souza", "D'Souza"],
    ["Anne-Marie K", "Anne-Marie"],
    ["Priya123 <b>", "Priya"],
  ])("%j → %j", (raw, said) => {
    expect(spokenName(raw)).toBe(said);
  });

  it.each([[null], [undefined], [""], ["   "], ["9848054321"], ["!!!"], ["-"]])("%j has nothing to say", (raw) => {
    expect(spokenName(raw)).toBeNull();
    expect(newOrderPhrase(raw)).toBe(NEW_ORDER_PHRASE);
  });

  it("cuts a very long word instead of reading it all out", () => {
    expect(spokenName("a".repeat(200))).toHaveLength(30);
  });

  it("names the customer", () => {
    expect(newOrderPhrase("Priya Sharma")).toBe("New order received from Priya");
  });
});

describe("readOrderSoundPref", () => {
  const withStored = (value: string | null) =>
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => (k === ORDER_SOUND_PREF_KEY ? value : null) } });

  it("is on until the vendor turns it off", () => {
    withStored(null);
    expect(readOrderSoundPref()).toBe(true);
    withStored("on");
    expect(readOrderSoundPref()).toBe(true);
    withStored("off");
    expect(readOrderSoundPref()).toBe(false);
  });
});

describe("fetchOrderFirstName", () => {
  it("asks our own server for the bill and returns the first name", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { firstName: "Priya" } })));
    vi.stubGlobal("fetch", fetchFn);
    await expect(fetchOrderFirstName("AWZ-20261013-0001")).resolves.toBe("Priya");
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/storefront-orders/announce?bill=AWZ-20261013-0001");
  });

  it.each([
    ["a 404", () => Promise.resolve(new Response("{}", { status: 404 }))],
    ["no name on the order", () => Promise.resolve(new Response(JSON.stringify({ data: { firstName: null } })))],
    ["a network error or timeout", () => Promise.reject(new Error("timeout"))],
  ])("gives null on %s, so the alert is not held up", async (_label, respond) => {
    vi.stubGlobal("fetch", vi.fn(respond));
    await expect(fetchOrderFirstName("AWZ-20261013-0001")).resolves.toBeNull();
  });
});

describe("speakNewOrder", () => {
  class FakeUtterance {
    lang = "";
    voice: unknown = null;
    constructor(public text: string) {}
  }

  type FakeVoice = { name: string; lang: string; localService: boolean; default: boolean };
  const voice = (name: string, lang: string, localService: boolean): FakeVoice => ({
    name,
    lang,
    localService,
    default: false,
  });

  function stubSpeech(opts: { speaking?: boolean; active?: boolean; voices?: FakeVoice[] } = {}) {
    const speak = vi.fn();
    vi.stubGlobal("window", {
      speechSynthesis: {
        speak,
        speaking: opts.speaking ?? false,
        pending: false,
        getVoices: () => opts.voices ?? [],
      },
      SpeechSynthesisUtterance: FakeUtterance,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: opts.active ?? true } });
    return speak;
  }

  it("says the phrase in Indian English, with \"customer\" when there is no name", () => {
    const speak = stubSpeech();
    expect(speakNewOrder()).toBe(true);
    const said = speak.mock.calls[0]![0] as FakeUtterance;
    expect(said.text).toBe(NEW_ORDER_PHRASE);
    expect(said.text).toBe("New order received from customer");
    expect(said.lang).toBe("en-IN");
  });

  it("says the customer's first name through an on-device voice, Indian English first", () => {
    const speak = stubSpeech({
      voices: [voice("Cloud English", "en-IN", false), voice("David", "en-US", true), voice("Heera", "en-IN", true)],
    });
    expect(speakNewOrder("Priya Sharma")).toBe(true);
    const said = speak.mock.calls[0]![0] as FakeUtterance;
    expect(said.text).toBe("New order received from Priya");
    expect((said.voice as FakeVoice).name).toBe("Heera");
  });

  it("keeps the name on the device when every voice sends its text away", () => {
    const speak = stubSpeech({ voices: [voice("Cloud English", "en-IN", false)] });
    expect(speakNewOrder("Priya Sharma")).toBe(true);
    const said = speak.mock.calls[0]![0] as FakeUtterance;
    expect(said.text).toBe(NEW_ORDER_PHRASE);
    expect(said.voice).toBeNull();
  });

  it("says the name through the system voice when the browser lists none (phones)", () => {
    const speak = stubSpeech({ voices: [] });
    speakNewOrder("Ravi");
    expect((speak.mock.calls[0]![0] as FakeUtterance).text).toBe("New order received from Ravi");
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
