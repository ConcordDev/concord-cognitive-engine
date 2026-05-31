#!/usr/bin/env node
// scripts/audit/gates/untuned-constants.mjs
//
// GATE SUITE — untuned-constant audit (what's never been balanced).
// Cross-checks docs/BALANCE_DIALS.md against the source. Two signals:
//   - DRIFT (floor 0, hard): a dial documented but NOT referenced in source
//     (doc rot), or a process.env.CONCORD_* dial in source but UNdocumented.
//   - UNTUNED (ratcheting backlog): dials still at first-draft defaults — their
//     doc row lacks a playtest marker ("adopted" / a sim-link). The count is the
//     "never been balanced" queue; it ratchets DOWN as dials get a real pass.
// Pattern D (constant-extraction). `--ci` fails on DRIFT only (untuned is a
// reported backlog, never a hard fail — you can't gate "has been playtested").

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOC = path.join(ROOT, "docs/BALANCE_DIALS.md");
const CI = process.argv.includes("--ci");

function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "tests") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// ── source dials: every CONCORD_* referenced in server/ — both the direct
// process.env.X form AND the quoted form helpers use (n("CONCORD_X", def) /
// b("CONCORD_X") in client-config + many libs), so helper-accessed dials aren't
// false doc-rot. ──────────────────────────────────────────────────────────────
const sourceDials = new Set();
for (const f of walk(path.join(ROOT, "server"))) {
  const t = fs.readFileSync(f, "utf8");
  for (const m of t.matchAll(/process\.env\.(CONCORD_[A-Z0-9_]+)/g)) sourceDials.add(m[1]);
  for (const m of t.matchAll(/["'](CONCORD_[A-Z0-9_]+)["']/g)) sourceDials.add(m[1]);
}

// ── doc dials: every CONCORD_* in BALANCE_DIALS.md, + per-line tuned marker ───
const docText = fs.readFileSync(DOC, "utf8");
const docDials = new Map(); // dial -> { tuned }
for (const line of docText.split("\n")) {
  const dials = [...line.matchAll(/`?(CONCORD_[A-Z0-9_]+)`?/g)].map((m) => m[1]).filter((d) => !d.endsWith("_")); // skip wildcard prefixes like CONCORD_POLL_*
  if (dials.length === 0) continue;
  // a row is "tuned" if it cites an adopted/sim value (not "unchanged (playtest)")
  const tuned = /adopted|\(\[G\d|sim-recommended[^|]*`[0-9]/.test(line) && !/unchanged \(playtest\)/.test(line);
  for (const d of dials) if (!docDials.has(d)) docDials.set(d, { tuned });
}

// ── cross-check ──────────────────────────────────────────────────────────────
const EXAMPLE = new Set(["CONCORD_SOMETHING"]); // the doc's illustrative placeholder
// HARD signal = doc rot: a documented balance dial that no longer exists in source.
const docRot = [...docDials.keys()].filter((d) => !sourceDials.has(d) && !EXAMPLE.has(d)).sort();
// INFORMATIONAL: env vars in source not in the dial doc (mostly kill-switches /
// infra / secrets — NOT all balance dials, so never a hard fail).
const inSourceNotDocumented = [...sourceDials].filter((d) => !docDials.has(d)).sort();
// INFORMATIONAL ratchet: documented dials still at first-draft defaults.
const untuned = [...docDials.entries()].filter(([, v]) => !v.tuned).map(([d]) => d).sort();
const tuned = [...docDials.entries()].filter(([, v]) => v.tuned).map(([d]) => d);

// --ci [floor]: fail only if doc-rot EXCEEDS the floor (ratchet, like schema-drift).
const floorArg = process.argv.find((a) => /^\d+$/.test(a));
const FLOOR = floorArg != null ? Number(floorArg) : 0;

const report = {
  generatedAt: new Date().toISOString(),
  totals: { documented: docDials.size, inSource: sourceDials.size, tuned: tuned.length, untuned: untuned.length, docRot: docRot.length, undocumented: inSourceNotDocumented.length },
  docRot, untuned, inSourceNotDocumented,
};
fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "audit/gate-untuned-constants.json"), JSON.stringify(report, null, 2));

console.log(`[untuned-constants] documented=${docDials.size} inSource=${sourceDials.size} tuned=${tuned.length} untuned=${untuned.length}`);
console.log(`[untuned-constants] DOC-ROT (hard, ratchet floor ${FLOOR}): ${docRot.length} documented dial(s) missing from source`);
if (docRot.length) console.log(`   ${docRot.slice(0, 15).join(", ")}${docRot.length > 15 ? " …" : ""}`);
console.log(`[untuned-constants] undocumented env vars (informational): ${inSourceNotDocumented.length}`);
console.log(`[untuned-constants] UNTUNED backlog (ratchet down via playtest): ${untuned.length}`);

if (CI && docRot.length > FLOOR) { console.error(`[untuned-constants] GATE FAIL: doc-rot ${docRot.length} > floor ${FLOOR}`); process.exit(1); }
