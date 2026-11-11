import { describe, expect, it } from "vitest";

import {
  normaliseWhatsappCommunityUrl,
  whatsappCommunityLabel,
  whatsappCommunityLink,
} from "@/lib/whatsapp-community";

const CODE = "E3hKX9ZqLmN8aB2cD4eF6g";
const CHANNEL = "0029VaAbCdEfGhIjKlMnOp3x";

describe("normaliseWhatsappCommunityUrl", () => {
  it("stores a group invite as a canonical https link, keeping the code's case", () => {
    expect(normaliseWhatsappCommunityUrl(`https://chat.whatsapp.com/${CODE}`)).toBe(`https://chat.whatsapp.com/${CODE}`);
    expect(normaliseWhatsappCommunityUrl(`  chat.whatsapp.com/${CODE}?mode=ems_copy_t `)).toBe(
      `https://chat.whatsapp.com/${CODE}`,
    );
    expect(normaliseWhatsappCommunityUrl(`http://CHAT.WHATSAPP.COM/invite/${CODE}/`)).toBe(
      `https://chat.whatsapp.com/${CODE}`,
    );
  });

  it("stores a channel link", () => {
    expect(normaliseWhatsappCommunityUrl(`https://www.whatsapp.com/channel/${CHANNEL}`)).toBe(
      `https://whatsapp.com/channel/${CHANNEL}`,
    );
    expect(normaliseWhatsappCommunityUrl(`whatsapp.com/channel/${CHANNEL}?utm=1`)).toBe(
      `https://whatsapp.com/channel/${CHANNEL}`,
    );
  });

  it("is empty for blank input, so the field can be cleared", () => {
    expect(normaliseWhatsappCommunityUrl("")).toBe("");
    expect(normaliseWhatsappCommunityUrl("   ")).toBe("");
    expect(normaliseWhatsappCommunityUrl(null)).toBe("");
  });

  it("refuses anything that is not a group invite or channel link", () => {
    for (const bad of [
      "https://wa.me/919876543210",
      `https://chat.whatsapp.com.evil.example/${CODE}`,
      `https://evil.example/chat.whatsapp.com/${CODE}`,
      `https://chat.whatsapp.com/${CODE}/extra`,
      "https://chat.whatsapp.com/short",
      `javascript:alert(1)//chat.whatsapp.com/${CODE}`,
      `https://whatsapp.com/channel/${CHANNEL}-x`,
      "Join my group",
    ]) {
      expect(normaliseWhatsappCommunityUrl(bad), bad).toBeNull();
    }
  });
});

describe("whatsappCommunityLink", () => {
  it("returns the stored link with its kind", () => {
    expect(whatsappCommunityLink(`https://chat.whatsapp.com/${CODE}`)).toEqual({
      href: `https://chat.whatsapp.com/${CODE}`,
      kind: "group",
    });
    expect(whatsappCommunityLink(`https://whatsapp.com/channel/${CHANNEL}`)).toEqual({
      href: `https://whatsapp.com/channel/${CHANNEL}`,
      kind: "channel",
    });
  });

  it("is null for nothing saved or a value that is not canonical", () => {
    expect(whatsappCommunityLink(null)).toBeNull();
    expect(whatsappCommunityLink("")).toBeNull();
    expect(whatsappCommunityLink(`chat.whatsapp.com/${CODE}`)).toBeNull();
    expect(whatsappCommunityLink("https://evil.example/")).toBeNull();
  });
});

describe("whatsappCommunityLabel", () => {
  it("names the kind of link", () => {
    expect(whatsappCommunityLabel("group")).toBe("Join our WhatsApp group");
    expect(whatsappCommunityLabel("channel")).toBe("Follow our WhatsApp channel");
  });
});
