#!/usr/bin/env node
// Generates Claude Code's agent config from the Cursor originals, which are the source of truth.
//
//   .cursor/rules/*.mdc  ->  .claude/rules/*.md   (globs -> paths; alwaysApply -> no paths)
//   .cursor/skills/**    ->  .claude/skills/**    (copied verbatim; same SKILL.md format)
//
// Usage:
//   node scripts/sync-agent-rules.mjs          # write .claude/
//   node scripts/sync-agent-rules.mjs --check  # exit 1 if .claude/ is out of date

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const SRC_RULES = join(root, ".cursor/rules");
const DST_RULES = join(root, ".claude/rules");
const SRC_SKILLS = join(root, ".cursor/skills");
const DST_SKILLS = join(root, ".claude/skills");

/** path (relative to root, forward slashes) -> expected content */
const expected = new Map();

function rel(p) {
  return relative(root, p).split("\\").join("/");
}

function convertRule(source, name) {
  const text = source.replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${name}: missing frontmatter`);
  const [, front, body] = match;

  const fields = {};
  for (const line of front.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  const alwaysApply = fields.alwaysApply === "true";
  const globs = fields.globs ? JSON.parse(fields.globs) : [];
  if (!alwaysApply && globs.length === 0) {
    throw new Error(`${name}: neither alwaysApply nor globs — Claude Code has no equivalent of a manual-only rule`);
  }

  const out = ["---"];
  if (fields.description) out.push(`description: ${fields.description}`);
  if (!alwaysApply) out.push(`paths: ${JSON.stringify(globs)}`);
  out.push("---", "", `<!-- Generated from .cursor/rules/${name}.mdc by scripts/sync-agent-rules.mjs. Edit the source, then re-run. -->`, "", "");
  return out.join("\n") + body.replace(/^\n+/, "");
}

for (const file of readdirSync(SRC_RULES).filter((f) => f.endsWith(".mdc")).sort()) {
  const name = file.slice(0, -".mdc".length);
  expected.set(rel(join(DST_RULES, `${name}.md`)), convertRule(readFileSync(join(SRC_RULES, file), "utf8"), name));
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const src of walk(SRC_SKILLS)) {
  expected.set(rel(join(DST_SKILLS, relative(SRC_SKILLS, src))), readFileSync(src, "utf8"));
}

const actual = new Set([...walk(DST_RULES), ...walk(DST_SKILLS)].map(rel));
const stale = [...actual].filter((p) => !expected.has(p));
// Ignore line endings: core.autocrlf checks these files out as CRLF on Windows.
const lf = (s) => s.replace(/\r\n/g, "\n");
const changed = [...expected].filter(([p, content]) => !actual.has(p) || lf(readFileSync(join(root, p), "utf8")) !== lf(content));

if (check) {
  if (stale.length === 0 && changed.length === 0) {
    console.log("Claude Code agent config is in sync with .cursor/.");
    process.exit(0);
  }
  for (const [p] of changed) console.error(`out of date: ${p}`);
  for (const p of stale) console.error(`no source:   ${p}`);
  console.error("Run: npm run sync:agent-rules");
  process.exit(1);
}

for (const p of stale) {
  rmSync(join(root, p));
  console.log(`removed ${p}`);
}
for (const [p, content] of changed) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), content);
  console.log(`wrote   ${p}`);
}
if (stale.length === 0 && changed.length === 0) console.log("Already in sync.");
