import fs from "node:fs";
import path from "node:path";

import type { Locator, Page, TestInfo } from "@playwright/test";

import { installDemoOverlay } from "./overlay";
import { ScreencastRecorder } from "./recorder";

/**
 * Runs one scene in front of the camera: records the page, paces every action
 * so a viewer can follow it, and logs the captions with their times.
 *
 * Captions are never drawn on the page (they would cover the buttons being
 * tapped). They go to cues.json, and scripts/demo-videos/render.mjs puts them
 * in a band above the phone. The same cue text is what the voice-over speaks
 * (scripts/demo-videos/voice.mjs, through the local `vo` tool), so a cue is one
 * short sentence.
 *
 * Output: demo-output/raw/<scene>/<project>/{frames/, frames.json, cues.json, meta.json}
 */

export type Cue = { t: number; text: string };

export type SceneMeta = {
  scene: string;
  title: string;
  /** Background colour of the finished video: the store's own colour. */
  accent: string;
  lang: "en";
};

const OUTPUT_ROOT = path.join(process.cwd(), "demo-output", "raw");

/**
 * The voice-over voice (Kokoro preset in the `vo` tool); the TTS cache is per voice.
 * hf_beta, an Indian voice reading English, was picked by ear on 2026-11-16.
 * Keep it in step with DEFAULT_VOICE in scripts/demo-videos/voice.mjs.
 */
export const DEMO_VOICE = process.env.DEMO_VOICE ?? "hf_beta";

/** Silence between two spoken lines: vo's own floor (0.12 s) plus a breath. */
const LINE_GAP_MS = 300;

/**
 * Spoken length of each caption, measured by `npm run demo:voice:prep` with the
 * same engine `vo` narrates with (scripts/demo-videos/tts_durations.py).
 * demo-output/tts/<voice>.json maps caption text → seconds.
 */
function loadSpokenLengths(): Map<string, number> {
  try {
    const file = path.join(process.cwd(), "demo-output", "tts", `${DEMO_VOICE}.json`);
    return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>));
  } catch {
    return new Map();
  }
}

/** Kokoro speaks ~166 words a minute (vo's measure for af_heart); the estimate until a line is measured. */
export function estimatedSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / 2.77) * 1000);
}

export class Director {
  readonly outDir: string;
  private readonly cues: Cue[] = [];
  private recorder: ScreencastRecorder | null = null;
  private readonly spoken = loadSpokenLengths();
  /** When the line now being spoken ends (epoch ms): the next caption waits for it. */
  private speechEndsAt = 0;
  /** Captions this run had no measured length for: run demo:voice:prep, then record again. */
  readonly unmeasured: string[] = [];

  constructor(
    readonly page: Page,
    testInfo: TestInfo,
    private readonly meta: SceneMeta,
  ) {
    this.outDir = path.join(OUTPUT_ROOT, meta.scene, testInfo.project.name);
    fs.mkdirSync(this.outDir, { recursive: true });
  }

  /** How long a caption takes to say, measured when known, else estimated. */
  speechMs(text: string): number {
    const measured = this.spoken.get(text);
    if (measured !== undefined) return Math.round(measured * 1000);
    if (!this.unmeasured.includes(text)) this.unmeasured.push(text);
    return estimatedSpeechMs(text);
  }

  /** Call before the first navigation the camera should see. */
  static async prepare(page: Page): Promise<void> {
    await page.addInitScript(installDemoOverlay);
  }

  async start(): Promise<void> {
    const viewport = this.page.viewportSize() ?? { width: 360, height: 640 };
    const scale = await this.page.evaluate(() => window.devicePixelRatio);
    this.recorder = new ScreencastRecorder(this.page, this.outDir, {
      width: Math.round(viewport.width * scale),
      height: Math.round(viewport.height * scale),
    });
    await this.recorder.start();
    await this.beat(600);
  }

  async stop(): Promise<void> {
    // Let the last line finish, then hold the final frame a moment.
    await this.beat(Math.max(0, this.speechEndsAt - Date.now()) + 1200);
    if (!this.recorder) return;
    await this.recorder.stop();
    this.recorder = null;
    fs.writeFileSync(path.join(this.outDir, "cues.json"), JSON.stringify(this.cues, null, 2));
    fs.writeFileSync(path.join(this.outDir, "meta.json"), JSON.stringify({ ...this.meta, voice: DEMO_VOICE }, null, 2));
    if (this.unmeasured.length > 0) {
      console.log(
        `[demo] ${this.unmeasured.length} caption(s) paced on an estimate. ` +
          "Run `npm run demo:voice:prep`, then record again so the voice-over never overlaps.",
      );
    }
  }

  /**
   * Show a caption (and, in the voice-over, speak it) from now until the next one.
   *
   * Waits first if the previous line is still being spoken, so two lines never
   * overlap: vo's anchored pacing would otherwise push every later line late.
   * Then pauses `wait` ms before the next action; by default the whole line, but a
   * scene can pass less to let taps happen while the voice talks.
   */
  async say(text: string, { wait }: { wait?: number } = {}): Promise<void> {
    const pending = this.speechEndsAt + LINE_GAP_MS - Date.now();
    if (this.speechEndsAt > 0 && pending > 0) await this.beat(pending);
    const speech = this.speechMs(text);
    const now = Date.now();
    this.cues.push({ t: now / 1000, text });
    this.speechEndsAt = now + speech;
    await this.beat(wait ?? Math.max(1600, speech));
  }

  /** Clear the caption band (an empty cue). */
  async quiet(): Promise<void> {
    this.cues.push({ t: Date.now() / 1000, text: "" });
  }

  async beat(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Bring an element into the middle of the screen at reading speed, if it isn't in view. */
  async reveal(target: Locator, { margin = 90 }: { margin?: number } = {}): Promise<void> {
    await target.waitFor({ state: "visible" });
    const offset = await target.evaluate((el, m) => {
      const r = el.getBoundingClientRect();
      if (r.top >= m && r.bottom <= window.innerHeight - m) return 0;
      return r.top + r.height / 2 - window.innerHeight / 2;
    }, margin);
    if (Math.abs(offset) < 1) return;

    // The page itself scrolls: pan it so the viewer sees where we went.
    const pageScrolls = await target.evaluate((el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p).overflowY;
        if ((s === "auto" || s === "scroll") && p.scrollHeight > p.clientHeight) return false;
      }
      return true;
    });
    if (pageScrolls) {
      await this.pan(offset, Math.min(1600, 500 + Math.abs(offset) * 1.2));
    } else {
      // Inside a sheet or dialog: let the browser scroll that container.
      await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await this.beat(700);
    }
  }

  /** Scroll the page by `px` over `ms`, eased. */
  async pan(px: number, ms = 1200): Promise<void> {
    await this.page.evaluate(([dy, d]) => (window as unknown as { __demo: { pan: (a: number, b: number) => Promise<void> } }).__demo.pan(dy, d), [px, ms] as const);
    await this.beat(250);
  }

  /** Show the fingertip on the element, then tap it. */
  async tap(target: Locator, { after = 700 }: { after?: number } = {}): Promise<void> {
    await this.reveal(target);
    const box = await target.boundingBox();
    if (box) {
      await this.page.evaluate(
        ([x, y]) => (window as unknown as { __demo?: { press: (a: number, b: number) => void } }).__demo?.press(x, y),
        [box.x + box.width / 2, box.y + box.height / 2] as const,
      );
      await this.beat(320);
    }
    await target.click();
    await this.beat(after);
  }

  /** Tap a field and type into it at a human speed. */
  async type(target: Locator, text: string, { delay = 70 }: { delay?: number } = {}): Promise<void> {
    await this.tap(target, { after: 250 });
    await target.pressSequentially(text, { delay });
    await this.beat(400);
  }
}
