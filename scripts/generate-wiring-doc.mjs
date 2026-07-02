#!/usr/bin/env node
// scripts/generate-wiring-doc.mjs
//
// H5.3 — the first GENERATED doc in docs/ (docs-as-build-artifact). Everything
// in docs/WIRING.md is COMPUTED at generation time from the same verifiers CI
// runs — never hand-typed. This is the antidote to narrative drift: the class
// of bug where a hand-written wiring doc goes stale and a reader (human or AI)
// acts on it (the 2026-07-02 audit caught exactly that — a stale "orphan emit"
// claim whose remediation would have deleted a live gameplay HUD).
//
//   node scripts/generate-wiring-doc.mjs           # (re)write docs/WIRING.md
//   node scripts/generate-wiring-doc.mjs --check   # exit 1 if committed doc
//                                                  # differs from freshly-computed
//
// Sources (all computed or stamped):
//   - scripts/verify-lens-backends.mjs   (run live — lens wiring ground truth)
//   - scripts/verify-invariant-test-links.mjs --json (run live — intent-layer health)
//   - audit/ux-polish.json               (grader artifact, committed + gated)
//   - audit/cartograph/SYSTEMS.json      (cartograph snapshot, self-stamped)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const OUT = path.join(ROOT, "docs", "WIRING.md");

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ── compute ──────────────────────────────────────────────────────────────────
const lens = JSON.parse(run("node", ["scripts/verify-lens-backends.mjs"]).trim().split("\n").pop());
const links = JSON.parse(run("node", ["scripts/verify-invariant-test-links.mjs", "--json"]));

let polish = null;
try {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, "audit", "ux-polish.json"), "utf8"));
  polish = { score: p.weightedScore ?? null, tiers: p.totals ?? null, stamped: p.generatedAt ?? null };
} catch { /* grader artifact absent — section omitted */ }

let carto = null;
try {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, "audit", "cartograph", "SYSTEMS.json"), "utf8"));
  carto = { generatedAt: s.generatedAt ?? null, stats: s.stats ?? null };
} catch { /* cartograph snapshot absent — section omitted */ }

const commit = run("git", ["rev-parse", "--short", "HEAD"]).trim();

// ── render ───────────────────────────────────────────────────────────────────
const lines = [];
lines.push("# Concord — Wiring Status (GENERATED — do not hand-edit)");
lines.push("");
lines.push(`> Generated from commit \`${commit}\` by \`scripts/generate-wiring-doc.mjs\`.`);
lines.push("> Every number below is COMPUTED by the named verifier at generation time.");
lines.push("> Regenerate: `node scripts/generate-wiring-doc.mjs` · Drift gate: `--check` in CI.");
lines.push("");
lines.push("## Lens ↔ backend wiring — `scripts/verify-lens-backends.mjs` (live run)");
lines.push("");
lines.push("| Metric | Value |");
lines.push("|---|---|");
for (const [k, v] of Object.entries(lens.verdicts)) lines.push(`| Lenses ${k} | ${v} |`);
lines.push(`| Total lenses | ${lens.total} |`);
lines.push(`| Macro domains | ${lens.macroDomains} |`);
lines.push(`| Route prefixes | ${lens.routePrefixes} |`);
lines.push("");
lines.push("## Invariant → test-link integrity — `scripts/verify-invariant-test-links.mjs` (live run)");
lines.push("");
lines.push(`- ${links.resolved}/${links.total} \`pinned by tests/…\` claims resolve to real files on disk.`);
if (links.missing?.length) {
  for (const m of links.missing) lines.push(`- ❌ MISSING: \`${m.ref}\` (referenced in ${m.referencedIn.join(", ")})`);
} else {
  lines.push("- All invariant proofs exist. A missing one fails CI (detectors-cartography workflow).");
}
lines.push("");
if (polish) {
  lines.push("## Lens UX polish — `scripts/grade-ux-polish.mjs` (committed artifact `audit/ux-polish.json`)");
  lines.push("");
  if (polish.score != null) lines.push(`- Weighted score: **${polish.score}**`);
  if (polish.tiers) lines.push(`- Tiers: \`${JSON.stringify(polish.tiers)}\``);
  lines.push("");
}
if (carto) {
  lines.push(`## Cartograph snapshot — \`audit/cartograph/SYSTEMS.json\`${carto.generatedAt ? ` (self-stamped ${carto.generatedAt})` : ""}`);
  lines.push("");
  if (carto.stats) lines.push("```json\n" + JSON.stringify(carto.stats, null, 2) + "\n```");
  lines.push("");
}
lines.push("---");
lines.push("_For event-wiring history and the abstraction-aware audit method (why raw grep");
lines.push("cannot adjudicate emit/listener liveness here), see `docs/research/WIRING_INTEGRITY_AUDIT.md`._");
lines.push("");
const body = lines.join("\n");

// ── emit / check ─────────────────────────────────────────────────────────────
// --check compares content EXCLUDING the commit-stamp line (the stamp changes
// every commit by definition; the gate is about the computed numbers).
const strip = (s) => s.split("\n").filter((l) => !l.startsWith("> Generated from commit")).join("\n");
if (CHECK) {
  let committed = "";
  try { committed = fs.readFileSync(OUT, "utf8"); } catch { /* absent */ }
  if (strip(committed) !== strip(body)) {
    console.error("docs/WIRING.md is STALE vs freshly-computed output. Regenerate: node scripts/generate-wiring-doc.mjs");
    process.exit(1);
  }
  console.log("docs/WIRING.md matches freshly-computed output ✓");
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote docs/WIRING.md (commit ${commit})`);
}
