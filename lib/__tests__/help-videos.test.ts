import { describe, expect, it } from "vitest";

import { HELP_TOPICS, ORDER_JOURNEY } from "@/lib/help-guide";
import { formatVideoLength, HELP_VIDEOS, helpVideoBase, helpVideosFor } from "@/lib/help-videos";

describe("help videos", () => {
  it("has unique ids that are safe file names", () => {
    const ids = HELP_VIDEOS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("points only at topics and journey steps the guide has", () => {
    const topics = new Set(HELP_TOPICS.map((t) => t.id));
    const steps = new Set(ORDER_JOURNEY.map((s) => s.id));
    for (const video of HELP_VIDEOS) {
      expect(video.topics.length + (video.journey?.length ?? 0), video.id).toBeGreaterThan(0);
      for (const id of video.topics) expect(topics.has(id), `${video.id} → ${id}`).toBe(true);
      for (const id of video.journey ?? []) expect(steps.has(id), `${video.id} → ${id}`).toBe(true);
      expect(video.lines.length, video.id).toBeGreaterThan(0);
      expect(video.kinds.length, video.id).toBeGreaterThan(0);
    }
  });

  it("offers kitchen films to food stores only", () => {
    for (const video of HELP_VIDEOS.filter((v) => !v.kinds.includes("goods"))) {
      const goods = helpVideosFor("goods", "https://x.public.blob.vercel-storage.com/help-videos");
      const offered = [...Object.values(goods.topics), ...Object.values(goods.journey)].flat();
      expect(offered.some((v) => v.id === video.id), video.id).toBe(false);
    }
  });

  it("shows nothing until a folder is published", () => {
    expect(helpVideosFor("food", undefined)).toEqual({ topics: {}, journey: {} });
    expect(helpVideosFor("food", "  ")).toEqual({ topics: {}, journey: {} });
    expect(helpVideosFor("food", "javascript:alert(1)")).toEqual({ topics: {}, journey: {} });
  });

  it("resolves files against the folder", () => {
    const { topics, journey } = helpVideosFor("food", "https://x.public.blob.vercel-storage.com/help-videos/");
    expect(topics["ring-up-sale"].map((v) => v.id)).toEqual(["f3-tap-billing-cash", "f1-bill-by-voice"]);
    expect(topics["check-payment"][0].src).toBe("https://x.public.blob.vercel-storage.com/help-videos/b4-check-upi-payment.mp4");
    expect(topics["check-payment"][0].poster).toBe("https://x.public.blob.vercel-storage.com/help-videos/b4-check-upi-payment.jpg");
    expect(journey.place[0].id).toBe("c1-buyer-order");
  });

  it("accepts a site path or an http(s) URL as the folder", () => {
    expect(helpVideoBase("/help-videos/")).toBe("/help-videos");
    expect(helpVideoBase("//evil.example/x")).toBeNull();
    expect(helpVideoBase("ftp://x/y")).toBeNull();
  });

  it("says how long a film is", () => {
    expect(formatVideoLength(37)).toBe("37 s");
    expect(formatVideoLength(60)).toBe("1 min");
  });
});
