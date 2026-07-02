#!/usr/bin/env node
// scripts/check-doc-claims-all.mjs
//
// Repo-wide docs-as-build-artifact gate (H5.1). The single-file extractor
// (check-doc-claims.mjs) re-runs every `**N** … (`cmd`)` claim in ONE doc;
// this wrapper fans it out over CLAUDE.md + every docs/*.md so a stale number
// ANYWHERE becomes a build failure instead of a landmine. Numbers in docs must
// be derived (carry a reproduction command), never merely asserted — the same
// trust→check philosophy as the rest of Concord, pointed at the docs.
//
// Per-file allowlist: docs listed in SKIP are historical snapshots whose whole
// point is to record a PAST state (they say so in their headers) — re-running
// their commands against today's tree is a category error, not a freshness
// check. Keep this list SHORT and justified; a live doc never belongs here.
//
// Usage: node scripts/check-doc-claims-all.mjs [--ci] [--json]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const CI = argv.includes("--ci");
const JSON_OUT = argv.includes("--json");

// Historical snapshots (dated audits) — their numbers describe a past commit
// by design. Everything else in docs/ is treated as live.
const SKIP = new Set([
  "docs/AUDIT_2026-05-10.md",
]);

const targets = [
  "CLAUDE.md",
  ...fs.readdirSync(path.join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`)
    .filter((f) => !SKIP.has(f)),
];

const results = [];
let failed = 0;
for (const file of targets) {
  let out = "";
  let ok = true;
  try {
    out = execFileSync("node", ["scripts/check-doc-claims.mjs", "--file", file, ...(CI ? ["--ci"] : [])], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    ok = false;
    failed++;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  results.push({ file, ok, out: out.trim() });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ checked: targets.length, failed, results: results.map(({ file, ok }) => ({ file, ok })) }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.file}`);
    if (!r.ok) console.log(r.out.split("\n").map((l) => `    ${l}`).join("\n"));
  }
  console.log(`\ndoc-claims: ${targets.length - failed}/${targets.length} files clean${SKIP.size ? ` (${SKIP.size} historical snapshot(s) skipped by design)` : ""}`);
}
if (CI && failed) process.exit(1);
