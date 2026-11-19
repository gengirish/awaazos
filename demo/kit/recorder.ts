import fs from "node:fs";
import path from "node:path";

import type { CDPSession, Page } from "@playwright/test";

/**
 * Records a page through Chrome's own screencast (CDP `Page.startScreencast`).
 *
 * Playwright's built-in video is a low-bitrate VP8 file at CSS-pixel size, so
 * text goes soft on a 1080 × 1920 phone frame. The screencast hands us each
 * frame as a JPEG with the time it was painted, at the browser's real pixel
 * ratio: playwright.demo.config.ts forces it at launch, since the emulated
 * deviceScaleFactor alone still gives 360 × 640 frames.
 * scripts/demo-videos/render.mjs turns the frames into an MP4.
 *
 * Chrome only sends a frame when the page changes, so frames have uneven
 * gaps: each one is held until the next (frames.json keeps the times).
 */

export type FrameLog = {
  /** Epoch seconds, the same clock as `Date.now() / 1000` on this machine. */
  startedAt: number;
  stoppedAt: number;
  width: number;
  height: number;
  frames: { file: string; t: number }[];
};

export class ScreencastRecorder {
  private cdp: CDPSession | null = null;
  private readonly frames: FrameLog["frames"] = [];
  private readonly writes: Promise<void>[] = [];
  private startedAt = 0;
  private readonly framesDir: string;

  constructor(
    private readonly page: Page,
    private readonly outDir: string,
    private readonly size: { width: number; height: number },
  ) {
    this.framesDir = path.join(outDir, "frames");
  }

  async start(): Promise<void> {
    fs.rmSync(this.framesDir, { recursive: true, force: true });
    fs.mkdirSync(this.framesDir, { recursive: true });

    const cdp = await this.page.context().newCDPSession(this.page);
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", (frame) => {
      const file = `f${String(this.frames.length).padStart(5, "0")}.jpg`;
      this.frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      this.writes.push(fs.promises.writeFile(path.join(this.framesDir, file), Buffer.from(frame.data, "base64")));
      // Without the ack Chrome stops sending frames.
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    this.startedAt = Date.now() / 1000;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: this.size.width,
      maxHeight: this.size.height,
      everyNthFrame: 1,
    });
  }

  async stop(): Promise<FrameLog> {
    const stoppedAt = Date.now() / 1000;
    if (this.cdp) {
      await this.cdp.send("Page.stopScreencast").catch(() => {});
      await this.cdp.detach().catch(() => {});
      this.cdp = null;
    }
    await Promise.all(this.writes);
    const log: FrameLog = {
      startedAt: this.startedAt,
      stoppedAt,
      width: this.size.width,
      height: this.size.height,
      frames: this.frames,
    };
    fs.writeFileSync(path.join(this.outDir, "frames.json"), JSON.stringify(log, null, 2));
    return log;
  }
}
