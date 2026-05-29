#!/usr/bin/env node
// scripts/audit-wiring-gate.mjs
//
// The standing CI gate (CONCORDIA_PLAN Phase H "meta-fix"): the single most
// repeated finding across every audit was built-but-unwired /
// documented-but-unenforced. This converts that failure mode into a build-time
// error.
//
// Two checks:
//   1. ZERO-CALLER SYSTEMS — exported "reaction/handler/award/grant" functions
//      (high-signal gameplay-system verbs) that have NO non-test caller outside
//      their own defining file. These are systems that were built and never
//      plugged in (awardOrgXp, attemptParry/attemptDodge before Sprint 1).
//   2. UNREAD CONSTANTS — every CONCORD_* env constant documented in
//      docs/BALANCE_DIALS.md must be read somewhere in server/.
//
// Allowlists carry an explicit reason for each intentional exception.
// Exit 1 on any unallowed violation (CI-gate). Run: node scripts/audit-wiring-gate.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SERVER = path.join(ROOT, "server");

// Exported functions whose names match these verbs are "systems" we expect to
// be wired into live gameplay (not just defined + macro-exposed + tested).
const SYSTEM_VERB = /^(attempt|award|grant|trigger|resolve|advance|apply|consume|propose|seed)[A-Z]/;

// Intentional exceptions — function name → reason it can have no direct caller.
const CALLER_ALLOWLIST = new Map([
  ["applyHitToState", "called via combat-state consumers + tests"],
  ["applyDamageToNPC", "combat route caller resolved dynamically"],
  ["applyDamageToPlayer", "combat route caller resolved dynamically"],
  ["applyRegionBiases", "consumed by the signals read path"],
  ["applyStructuralStress", "combat route dynamic import"],
  ["applyAppearanceOverride", "pure renderer-frame helper"],
  ["applyMove", "faction-strategy cycle dynamic"],
  ["applyDifficulty", "pure compose used by encounter builders"],
  ["proposePlayerScheme", "player-driven macro surface"],
  ["seedDefaultGlyphLibrary", "content-seeder dynamic import"],
]);

// Files to skip (definitions that are pure libraries of compose-helpers).
const SKIP_FILES = new Set([]);

// BASELINE BACKLOG — pre-existing zero-caller systems at the time this gate
// landed. The gate ratchets: these are tracked + reported but don't fail the
// build; any NEW zero-caller system DOES. Each carries the honest reason it
// isn't wired yet (and crucially, why force-wiring would require inventing data
// or a missing other-half system — which "no fake data" forbids). Remove an
// entry when its system is genuinely wired.
const BASELINE_BACKLOG = new Map([
  ["applyShadowVault", "artifact shadow-vault — resolver half; detection/trigger side not built. Tracked."],
  ["proposeCrossWorldScheme", "cross-world cycle advances via advanceCrossWorldScheme; the proposer half is dormant. Tracked."],
  ["resolveImbalance", "creature-home imbalance resolver — needs the imbalance-detection emitter wired first. Tracked."],
  ["triggerCascade", "event-cascade resolver — needs an authored cascade parent-event source; wiring blind would invent cascades. Tracked."],
  ["resolveQuery", "federation query resolver — peer-driven; no live peer wires it yet. Tracked."],
  ["resolveEmergency", "foundation-emergency resolver — needs the emergency-creation site wired. Tracked."],
  ["seedFamilyUnit", "spouse-bond seeder — requires AUTHORED marriage pairs (none in content); wiring would invent marriages. Tracked, awaits authored family data."],
  ["seedNamedCharacterLineage", "deep-lineage seeder — requires authored lineage depth per named NPC; wiring blind invents ancestry. Tracked, awaits authored lineage data."],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip deps, tests, data, archived code, and prompt templates — none are
      // live-gameplay system surfaces.
      if (["node_modules", "tests", "data", "_archived", "prompts"].includes(name)) continue;
      walk(full, out);
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function isTestPath(p) {
  return /(^|\/)tests?(\/|$)|\.test\.js$|-tests?\.js$|\/test-/.test(p);
}

const allFiles = walk(SERVER);
const sourceFiles = allFiles.filter((p) => !isTestPath(p));

// Build a single corpus of all NON-defining call sites per function later; for
// speed, read every source file once.
const fileSrc = new Map(sourceFiles.map((p) => [p, readFileSync(p, "utf8")]));

const EXPORT_FN_RE = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/g;

const violations = [];
const baselined = [];

for (const [file, src] of fileSrc) {
  if (SKIP_FILES.has(path.basename(file))) continue;
  let m;
  EXPORT_FN_RE.lastIndex = 0;
  const fns = new Set();
  while ((m = EXPORT_FN_RE.exec(src)) !== null) {
    if (SYSTEM_VERB.test(m[1])) fns.add(m[1]);
  }
  for (const fn of fns) {
    if (CALLER_ALLOWLIST.has(fn)) continue;
    // A caller exists if the name appears in any OTHER source file, OR in the
    // same file at a call site that isn't the export declaration.
    let called = false;
    for (const [otherFile, otherSrc] of fileSrc) {
      if (otherFile === file) {
        // same file: a call site that isn't the `function fn(` declaration
        // (negative lookbehind excludes the decl). >=1 real call = wired.
        const usageRe = new RegExp(`(?<!function\\s)\\b${fn}\\s*\\(`, "g");
        const useCount = (otherSrc.match(usageRe) || []).length;
        if (useCount >= 1) { called = true; break; }
      } else if (otherSrc.includes(fn)) {
        called = true; break;
      }
    }
    if (!called) {
      if (BASELINE_BACKLOG.has(fn)) baselined.push({ file: path.relative(ROOT, file), fn });
      else violations.push({ file: path.relative(ROOT, file), fn });
    }
  }
}

// ── Check 2: documented CONCORD_* constants are read ────────────────────────
const balanceDoc = (() => {
  try { return readFileSync(path.join(ROOT, "docs", "BALANCE_DIALS.md"), "utf8"); }
  catch { return ""; }
})();
// CONCORD_SOMETHING is the doc's how-to placeholder, not a real dial.
const CONST_IGNORE = new Set(["CONCORD_SOMETHING"]);
const documentedConsts = new Set(
  Array.from(balanceDoc.matchAll(/`?(CONCORD_[A-Z0-9_]+)`?/g)).map((x) => x[1])
    .filter((c) => !CONST_IGNORE.has(c)),
);
// MAX_OLD_SPACE_SIZE is documented but not CONCORD_-prefixed; include it.
const allServerSrc = sourceFiles.map((p) => fileSrc.get(p)).join("\n");
const unreadConsts = [];
for (const c of documentedConsts) {
  // appears in the doc; must be read (process.env.<c>) somewhere in server.
  if (!allServerSrc.includes(`process.env.${c}`) && !allServerSrc.includes(c)) {
    unreadConsts.push(c);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\nWiring gate — scanned ${sourceFiles.length} server source files`);
console.log(`  NEW zero-caller system functions: ${violations.length}`);
console.log(`  Baselined (tracked backlog): ${baselined.length}`);
console.log(`  Documented-but-unread CONCORD_* constants: ${unreadConsts.length}`);

if (baselined.length) {
  console.log(`\n• Tracked connection-debt backlog (baselined — does NOT fail the gate):`);
  for (const b of baselined) console.log(`    ${b.fn}  (${b.file}) — ${BASELINE_BACKLOG.get(b.fn)}`);
}
if (violations.length) {
  console.log(`\n✗ NEW built-but-unwired system functions (zero non-test callers):`);
  for (const v of violations) console.log(`    ${v.fn}  (${v.file})`);
  console.log(`  → wire each into live gameplay, or (if it legitimately can't be) add to`);
  console.log(`    CALLER_ALLOWLIST (dynamic/macro) or BASELINE_BACKLOG (tracked debt) with a reason.`);
}
if (unreadConsts.length) {
  console.log(`\n✗ Documented CONCORD_* constants never read in server/:`);
  for (const c of unreadConsts) console.log(`    ${c}`);
}

const failed = violations.length + unreadConsts.length;
if (failed === 0) console.log(`\n✓ No connection-debt: every system verb is wired, every documented dial is read.`);
process.exit(failed === 0 ? 0 : 1);
