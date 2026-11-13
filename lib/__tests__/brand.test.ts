import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BRAND_FORMER_NAME, BRAND_NAME, BRAND_SIGNOFF, BRAND_TAGLINE } from "@/lib/brand";

/**
 * The name is spelled once, in lib/brand.ts. These checks fail if the former
 * name comes back as text anywhere in app code, or if a file that can't import
 * the module falls out of step with it. Comments and identifiers are not
 * checked: they are not shown to anyone.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const CODE_DIRS = ["app", "components", "lib", "hooks", "workers"];
const BRAND_FILE = path.join(ROOT, "lib", "brand.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Text a user could see: string literals, template text and JSX text. */
function shownText(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("brand", () => {
  it("builds the sign-off from the name and tagline", () => {
    expect(BRAND_SIGNOFF).toBe(`${BRAND_NAME} — ${BRAND_TAGLINE}`);
    expect(BRAND_NAME).not.toBe(BRAND_FORMER_NAME);
  });

  it("never shows the former name as text in app code (read it from lib/brand.ts)", () => {
    const offenders: string[] = [];
    for (const dir of CODE_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of sourceFiles(abs)) {
        if (file === BRAND_FILE) continue;
        for (const text of shownText(file)) {
          if (text.includes(BRAND_FORMER_NAME)) offenders.push(`${path.relative(ROOT, file)}: ${text.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it("keeps files that can't import lib/brand.ts on the current name", () => {
    const files = [
      "public/sw.js",
      "public/offline.html",
      ...fs.readdirSync(path.join(ROOT, "content", "admin-nudges")).filter((f) => f.endsWith(".txt"))
        .map((f) => `content/admin-nudges/${f}`),
    ];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(text, rel).toContain(BRAND_NAME);
      expect(text, rel).not.toContain(BRAND_FORMER_NAME);
    }
  });

  it("keeps the manifest id, so installed apps stay the same app", () => {
    const manifest = fs.readFileSync(path.join(ROOT, "app", "manifest.ts"), "utf8");
    expect(manifest).toMatch(/id: "\/"/);
  });
});
