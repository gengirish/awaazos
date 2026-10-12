import fs from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

/**
 * Mobile baseline sweep — measuring half.
 *
 * `auditPage` runs inside the browser and reports two things for the current
 * viewport: horizontal overflow (with the elements that cause it) and every
 * interactive element smaller than the 44x44 CSS px tap-target minimum
 * (.cursor/rules/accessibility.mdc).
 *
 * `compareWithBaseline` / `writeBaselineEntry` are the ratchet: known
 * violations live in `e2e/mobile-sweep.baseline.json`, and only violations
 * that are NOT in that file fail the test.
 */

export const MIN_TAP_PX = 44;

/**
 * Elements up to this many px ABOVE the minimum are recorded in the baseline
 * too (never reported as violations). The baseline is generated on one machine
 * and enforced on another (Windows dev box → Linux CI); font rasterisation can
 * move a text-sized control a pixel or two across the 44 px line, and that must
 * not turn CI red.
 */
export const NEAR_MISS_SLACK_PX = 4;

export const BASELINE_PATH = path.join(__dirname, "..", "mobile-sweep.baseline.json");
export const OUTPUT_DIR = path.join(__dirname, "..", "..", "test-results", "mobile-baseline");

export const UPDATE_BASELINE = process.env.MOBILE_SWEEP_UPDATE === "1";

export type TapTarget = {
  role: string;
  name: string;
  /** CSS px, rounded. */
  width: number;
  height: number;
};

export type PageAudit = {
  /** scrollWidth - clientWidth of the document (or of the overlay root, whichever is worse). */
  overflowPx: number;
  /** Innermost elements that stick out of the viewport, widest first. Empty when there is no overflow. */
  overflowCulprits: string[];
  /** Interactive elements below MIN_TAP_PX + NEAR_MISS_SLACK_PX in either dimension. */
  smallTargets: TapTarget[];
  /**
   * Information only, never a failure: regions that scroll sideways inside the
   * page (wide tables, chip rows) and how many px of them are out of view.
   */
  horizontalScrollers: string[];
  /** How many interactive elements were measured at all. */
  measured: number;
  /** Links/buttons skipped under the WCAG 2.5.8 inline exception. */
  inlineExempt: number;
};

type AuditArgs = { rootSelector: string | null; limit: number };

/**
 * Measure the page as it is right now. `rootSelector` scopes the tap-target
 * check to an overlay (the last visible match is used) — everything behind an
 * open dialog is inert and must not be counted.
 */
export async function auditPage(page: Page, rootSelector: string | null = null): Promise<PageAudit> {
  return page.evaluate(
    ({ rootSelector, limit }: AuditArgs): PageAudit => {
      const INTERACTIVE = [
        "a[href]",
        "button",
        "[role=button]",
        "[role=tab]",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "[role=checkbox]",
        "[role=switch]",
        "[role=combobox]",
      ].join(",");

      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

      let root: Element = document.body;
      if (rootSelector) {
        const matches = Array.from(document.querySelectorAll(rootSelector)).filter((el) =>
          (el as HTMLElement).checkVisibility(),
        );
        const last = matches[matches.length - 1];
        if (!last) throw new Error(`mobile sweep: no visible element matches ${rootSelector}`);
        root = last;
      }

      // ── Tap targets ────────────────────────────────────────────────
      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "input") return `input[${(el as HTMLInputElement).type}]`;
        return tag;
      };

      const nameOf = (el: Element): string => {
        const aria = clean(el.getAttribute("aria-label"));
        if (aria) return aria;
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = clean(
            labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" "),
          );
          if (text) return text;
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          const label = clean(Array.from(el.labels ?? []).map((l) => l.textContent).join(" "));
          if (label) return label;
          const fallback =
            clean(el.getAttribute("placeholder")) || clean(el.getAttribute("name")) || clean(el.id);
          if (fallback) return fallback;
        }
        const text = clean(el.textContent);
        if (text) return text;
        const alt = clean(el.querySelector("img[alt]")?.getAttribute("alt"));
        if (alt) return alt;
        return clean(el.getAttribute("title")) || "(no name)";
      };

      /** A link/button that is part of a sentence (WCAG 2.5.8 "inline" exception). */
      const isInlineInText = (el: Element): boolean => {
        const tag = el.tagName.toLowerCase();
        if (tag !== "a" && tag !== "button") return false;
        if (getComputedStyle(el).display !== "inline") return false;
        let block = el.parentElement;
        while (block && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
        if (!block) return false;
        // Text in the same block that does not belong to any interactive element.
        let own = "";
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.parentElement?.closest("a,button")) own += node.textContent ?? "";
        }
        const letters = own.replace(/[^\p{L}]/gu, "");
        return letters.length >= 5;
      };

      const smallTargets: TapTarget[] = [];
      let measured = 0;
      let inlineExempt = 0;

      for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
        const html = el as HTMLElement;
        if (!html.checkVisibility({ visibilityProperty: true })) continue;
        if (el.closest("[inert],[aria-hidden=true]")) continue;
        if (el.matches(":disabled") || el.closest("[aria-disabled=true]")) continue;

        let rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const srOnly =
          rect.width <= 1 ||
          rect.height <= 1 ||
          style.clip === "rect(0px, 0px, 0px, 0px)" ||
          style.clipPath === "inset(50%)";

        // Native checkbox / radio / file input: the wrapping (or associated)
        // label is the real tap target, including when the input is sr-only.
        const input = el instanceof HTMLInputElement ? el : null;
        if (input && ["checkbox", "radio", "file"].includes(input.type)) {
          const label = input.closest("label") ?? input.labels?.[0] ?? null;
          if (label && (label as HTMLElement).checkVisibility()) {
            const lr = label.getBoundingClientRect();
            if (lr.width * lr.height > rect.width * rect.height) rect = lr;
          } else if (srOnly) {
            continue;
          }
        } else if (srOnly) {
          continue; // sr-only control or skip link
        }

        // Parked off-screen until focused (skip links).
        if (rect.bottom <= 0 || rect.right <= 0) continue;

        if (isInlineInText(el)) {
          inlineExempt += 1;
          continue;
        }

        measured += 1;
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (width < limit || height < limit) {
          smallTargets.push({ role: roleOf(el), name: nameOf(el), width, height });
        }
      }

      // ── Horizontal overflow ────────────────────────────────────────
      let overflowPx = doc.scrollWidth - doc.clientWidth;
      if (root !== document.body) {
        const rr = root.getBoundingClientRect();
        overflowPx = Math.max(overflowPx, root.scrollWidth - root.clientWidth, rr.right - vw, -rr.left);
      }
      overflowPx = Math.round(overflowPx);

      const overflowCulprits: string[] = [];
      if (overflowPx > 1) {
        const contained = (el: Element): boolean => {
          for (let p = el.parentElement; p && p !== document.body && p !== doc; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX !== "visible" || s.position === "fixed") return true;
          }
          return getComputedStyle(el).position === "fixed";
        };
        const sticking = Array.from(document.body.querySelectorAll("*")).filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (r.right <= vw + 1 && r.left >= -1) return false;
          return !contained(el);
        });
        const set = new Set(sticking);
        const innermost = sticking.filter((el) => !Array.from(el.children).some((c) => set.has(c)));
        innermost
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .sort((a, b) => b.r.right - a.r.right || b.r.width - a.r.width)
          .slice(0, 5)
          .forEach(({ el, r }) => {
            const classes = Array.from(el.classList).slice(0, 4).join(".");
            const id = el.id ? `#${el.id}` : "";
            const text = clean(el.textContent).slice(0, 40);
            overflowCulprits.push(
              `<${el.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ""}> "${text}" ` +
                `left=${Math.round(r.left)} right=${Math.round(r.right)} width=${Math.round(r.width)} (viewport ${vw})`,
            );
          });
      }

      const horizontalScrollers = Array.from(document.body.querySelectorAll("*"))
        .filter((el) => {
          const ox = getComputedStyle(el).overflowX;
          return (
            (ox === "auto" || ox === "scroll") &&
            el.scrollWidth - el.clientWidth > 1 &&
            (el as HTMLElement).checkVisibility()
          );
        })
        .map((el) => {
          const classes = Array.from(el.classList).slice(0, 4).join(".");
          const label = clean(el.getAttribute("aria-label")) || clean(el.textContent).slice(0, 30);
          return `<${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""}> "${label}" hides ${el.scrollWidth - el.clientWidth}px`;
        });

      return { overflowPx, overflowCulprits, horizontalScrollers, smallTargets, measured, inlineExempt };
    },
    { rootSelector, limit: MIN_TAP_PX + NEAR_MISS_SLACK_PX },
  );
}

// ── Signatures ───────────────────────────────────────────────────────

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DAYS = "Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?";
const MONTH_RE = new RegExp(`\\b(?:${MONTHS})\\b`, "g");
const DAY_RE = new RegExp(`\\b(?:${DAYS})\\b`, "g");

/**
 * `role "name"` with everything that changes between runs taken out: the
 * per-run vendor name / slug / email (`volatile`), digits (bill numbers,
 * amounts, dates, times) and day / month names. Size is deliberately NOT part
 * of the signature — see NEAR_MISS_SLACK_PX.
 */
export function signatureOf(target: Pick<TapTarget, "role" | "name">, volatile: string[] = []): string {
  let name = target.name;
  for (const token of volatile) {
    if (token) name = name.split(token).join("<vendor>");
  }
  name = name.replace(DAY_RE, "<day>").replace(MONTH_RE, "<month>").replace(/\d/g, "#");
  if (name.length > 60) name = `${name.slice(0, 60)}…`;
  return `${target.role} "${name}"`;
}

// ── Baseline file ────────────────────────────────────────────────────

export type BaselineTarget = { count: number; size: string };
export type BaselineEntry = { overflow: boolean; tapTargets: Record<string, BaselineTarget> };
export type Baseline = {
  minTapPx: number;
  /** project name → "route@width" → entry */
  projects: Record<string, Record<string, BaselineEntry>>;
};

export function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return { minTapPx: MIN_TAP_PX, projects: {} };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

/** Pretty JSON with one tap target per line, keys sorted, so diffs stay readable. */
function serialiseBaseline(baseline: Baseline): string {
  const lines: string[] = ["{", `  "minTapPx": ${baseline.minTapPx},`, '  "projects": {'];
  const projects = Object.keys(baseline.projects).sort();
  projects.forEach((project, pi) => {
    lines.push(`    ${JSON.stringify(project)}: {`);
    const keys = Object.keys(baseline.projects[project]).sort();
    keys.forEach((key, ki) => {
      const entry = baseline.projects[project][key];
      const sigs = Object.keys(entry.tapTargets).sort();
      lines.push(`      ${JSON.stringify(key)}: {`);
      lines.push(`        "overflow": ${entry.overflow},`);
      if (sigs.length === 0) {
        lines.push('        "tapTargets": {}');
      } else {
        lines.push('        "tapTargets": {');
        sigs.forEach((sig, si) => {
          const t = entry.tapTargets[sig];
          const comma = si < sigs.length - 1 ? "," : "";
          lines.push(
            `          ${JSON.stringify(sig)}: { "count": ${t.count}, "size": ${JSON.stringify(t.size)} }${comma}`,
          );
        });
        lines.push("        }");
      }
      lines.push(`      }${ki < keys.length - 1 ? "," : ""}`);
    });
    lines.push(`    }${pi < projects.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

type Grouped = Record<string, { count: number; violating: number; width: number; height: number }>;

function group(audit: PageAudit, volatile: string[]): Grouped {
  const out: Grouped = {};
  for (const t of audit.smallTargets) {
    const sig = signatureOf(t, volatile);
    const g = (out[sig] ??= { count: 0, violating: 0, width: t.width, height: t.height });
    g.count += 1;
    if (t.width < MIN_TAP_PX || t.height < MIN_TAP_PX) g.violating += 1;
    // Keep the worst (smallest) instance as the recorded size.
    if (Math.min(t.width, t.height) < Math.min(g.width, g.height)) {
      g.width = t.width;
      g.height = t.height;
    }
  }
  return out;
}

/** MOBILE_SWEEP_UPDATE=1: record what the page looks like today. */
export function writeBaselineEntry(project: string, key: string, audit: PageAudit, volatile: string[]): void {
  const baseline = readBaseline();
  const tapTargets: Record<string, BaselineTarget> = {};
  for (const [sig, g] of Object.entries(group(audit, volatile))) {
    tapTargets[sig] = { count: g.count, size: `${g.width}x${g.height}` };
  }
  baseline.minTapPx = MIN_TAP_PX;
  (baseline.projects[project] ??= {})[key] = { overflow: audit.overflowPx > 1, tapTargets };
  fs.writeFileSync(BASELINE_PATH, serialiseBaseline(baseline));
}

export type Comparison = {
  /** Not in the baseline — these fail the test. */
  regressions: string[];
  /** In the baseline but no longer happening — logged so the baseline can be tightened. */
  fixed: string[];
};

export function compareWithBaseline(
  baseline: Baseline,
  project: string,
  key: string,
  audit: PageAudit,
  volatile: string[],
): Comparison {
  const entry: BaselineEntry = baseline.projects[project]?.[key] ?? { overflow: false, tapTargets: {} };
  const regressions: string[] = [];
  const fixed: string[] = [];

  const overflowing = audit.overflowPx > 1;
  if (overflowing && !entry.overflow) {
    regressions.push(
      `horizontal overflow of ${audit.overflowPx}px. Widest offenders:\n` +
        audit.overflowCulprits.map((c) => `      ${c}`).join("\n"),
    );
  }
  if (!overflowing && entry.overflow) fixed.push("horizontal overflow is gone");

  const now = group(audit, volatile);
  for (const [sig, g] of Object.entries(now)) {
    const allowed = entry.tapTargets[sig]?.count ?? 0;
    if (g.violating > allowed) {
      const extra = g.violating - allowed;
      regressions.push(
        `tap target under ${MIN_TAP_PX}x${MIN_TAP_PX}: ${sig} is ${g.width}x${g.height}` +
          (allowed > 0 ? ` (${g.violating} on the page, baseline allows ${allowed})` : extra > 1 ? ` (x${extra})` : ""),
      );
    }
  }
  for (const [sig, known] of Object.entries(entry.tapTargets)) {
    const [w, h] = known.size.split("x").map(Number);
    if (w >= MIN_TAP_PX && h >= MIN_TAP_PX) continue; // near miss, never a violation
    const violating = now[sig]?.violating ?? 0;
    if (violating < known.count) {
      fixed.push(`${sig} (${known.size}): baseline has ${known.count}, page now has ${violating}`);
    }
  }
  return { regressions, fixed };
}

export function slugForRoute(routeKey: string): string {
  const slug = routeKey
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "home";
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
