#!/usr/bin/env node
/**
 * CI gate: `npm audit`, failing on any high or critical advisory except the ones
 * listed below. An entry is only for an advisory with **no patched version** that
 * we can't remove (check `npm ls <pkg>`), and it carries a review date: past that
 * date it fails again, so nothing stays waived by accident. When a fix ships,
 * update the dependency and delete the entry.
 *
 *   node scripts/audit-high.mjs        (what CI runs)
 */
import { execFileSync } from "node:child_process";

/** GHSA id → why it is safe for now, and the date to look again. */
const ALLOWED = {};

const FAIL = new Set(["high", "critical"]);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // npm audit exits 1 when it finds anything; the report is still on stdout.
  raw = err.stdout;
}

let report;
try {
  report = JSON.parse(String(raw ?? "").replace(/^﻿/, ""));
} catch {
  console.error("npm audit did not return JSON:\n" + String(raw).slice(0, 2000));
  process.exit(1);
}
if (report.error) {
  console.error("npm audit failed:", report.error.summary ?? report.error);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const blocking = new Map();
const waived = new Map();

for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !FAIL.has(via.severity)) continue;
    const id = String(via.url ?? "").split("/").pop() || via.title;
    const allow = ALLOWED[id];
    const line = `${id}  ${via.severity}  ${via.name}@${via.range}  ${via.title}`;
    if (allow && today <= allow.reviewBy) waived.set(id, `${line}  (waived until ${allow.reviewBy})`);
    else blocking.set(id, allow ? `${line}  (waiver expired ${allow.reviewBy})` : `${line}  [${pkg}]`);
  }
}

for (const line of waived.values()) console.log("waived: " + line);
for (const id of Object.keys(ALLOWED)) {
  if (!waived.has(id) && !blocking.has(id)) console.log(`stale waiver, no longer reported: ${id} (delete it)`);
}

if (blocking.size > 0) {
  console.error(`\n${blocking.size} high/critical advisory(ies):`);
  for (const line of blocking.values()) console.error("  " + line);
  process.exit(1);
}
console.log("npm audit: no unwaived high or critical advisories.");
