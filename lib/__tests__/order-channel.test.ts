import { describe, expect, it } from "vitest";

import { orderChannelFor, orderSrcFromSearch, withInstagramTag } from "@/lib/order-channel";

const IG_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Instagram 310.0.0.0.0 Android";
const IG_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 310.0.0 (iPhone14,5)";
const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const FACEBOOK = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]";

describe("withInstagramTag", () => {
  it("adds the tag to a plain store link", () => {
    expect(withInstagramTag("https://x.test/s/sam")).toBe("https://x.test/s/sam?src=ig");
  });

  it("keeps an existing query and hash", () => {
    expect(withInstagramTag("https://x.test/s/sam?a=1")).toBe("https://x.test/s/sam?a=1&src=ig");
    expect(withInstagramTag("https://x.test/s/sam#drop-1")).toBe("https://x.test/s/sam?src=ig#drop-1");
  });
});

describe("orderSrcFromSearch", () => {
  it("reads only the Instagram tag", () => {
    expect(orderSrcFromSearch("?src=ig")).toBe("ig");
    expect(orderSrcFromSearch("?a=1&src=ig")).toBe("ig");
    expect(orderSrcFromSearch("?src=wa")).toBeUndefined();
    expect(orderSrcFromSearch("")).toBeUndefined();
  });

  it("round-trips a tagged link", () => {
    expect(orderSrcFromSearch(new URL(withInstagramTag("https://x.test/s/sam#d")).search)).toBe("ig");
  });
});

describe("orderChannelFor", () => {
  it("counts Instagram's in-app browser on both platforms", () => {
    expect(orderChannelFor({ userAgent: IG_ANDROID })).toBe("instagram");
    expect(orderChannelFor({ userAgent: IG_IPHONE })).toBe("instagram");
  });

  it("counts a tagged link opened in another browser", () => {
    expect(orderChannelFor({ src: "ig", userAgent: CHROME })).toBe("instagram");
  });

  it("does not guess for anything else", () => {
    expect(orderChannelFor({ userAgent: CHROME })).toBeNull();
    expect(orderChannelFor({ userAgent: FACEBOOK })).toBeNull();
    expect(orderChannelFor({ src: "wa", userAgent: null })).toBeNull();
    expect(orderChannelFor({})).toBeNull();
  });
});
