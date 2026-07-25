// scripts/autoloop/guard.mjs
// AUTOMATED anti-gaming gate. Run before every commit the loop makes. Rejects the
// wave (exit 1) — NO human needed — if the diff games a metric. This is the
// structural reward-hacking cure that must survive "maximize autonomy": the SWE-bench
// reward-hacking literature shows agents game graders, hardcode to visible tests, and
// weaken assertions; this gate makes those moves un-committable.
//
// Usage: node scripts/autoloop/guard.mjs            (inspects the working diff vs HEAD)
// Exit 0 = clean to commit. Exit 1 = blocked (reason printed).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { REPO, run, changedFiles, ok, bad, warn } from "./lib.mjs";

// 1) Files the loop must NEVER modify — graders, honesty guards, ratchet baselines,
//    the value-assertion harnesses, and the loop's own scripts. Editing any of these
//    is how an agent would move the goalposts instead of doing the work.
const PROTECTED = [
  /^scripts\/grade-macro-depth\.mjs$/,
  /^scripts\/grade-ux-polish\.mjs$/,
  /^scripts\/check-depth-tests\.mjs$/,
  /^scripts\/depth-backlog\.mjs$/,
  /^scripts\/macro-assassin\.mjs$/,
  /^scripts\/adversarial-audit\.mjs$/,
  /^scripts\/value-assertions-batch\d+\.mjs$/,
  /^scripts\/crud-(update-)?invariants\.mjs$/,
  /^scripts\/verify-lens-backends\.mjs$/,
  /^scripts\/lens-broken-calls\.mjs$/,
  /^scripts\/audit-emergent-wiring\.mjs$/,
  /^scripts\/check-orphaned-events\.mjs$/,
  /^scripts\/autoloop\//,
  /BASELINE\.json$/,
  /^audit\/detectors\/BUDGET\.json$/,
];

// 2) Money / auth invariant files — edits here are a HARD human-escalation, never autonomous.
const INVARIANT = [
  /^server\/economy\/royalty-cascade\.js$/,
  /^server\/economy\/withdrawals\.js$/,
  /^server\/economy\/balances\.js$/,
  /^server\/lib\/creative-marketplace-constants\.js$/,
  /^server\/lib\/coin-service\.js$/,
];

const files = changedFiles();
const violations = [];

for (const f of files) {
  if (PROTECTED.some((re) => re.test(f))) violations.push(`PROTECTED (grader/harness/baseline) edited: ${f}`);
  if (INVARIANT.some((re) => re.test(f))) violations.push(`MONEY/AUTH INVARIANT edited — must escalate, not auto-commit: ${f}`);
}

// 3) Weakened tests: an existing tracked test file whose assertion count DROPPED vs HEAD.
//    (Adding new tests is the whole point; removing/weakening assertions is gaming.)
// NOTE: ASSERT_RE's bare `expect` alternative also matches the "expect" substring inside
// the TypeScript compiler directive `@ts-expect-error` (word-boundaries on both sides land
// on the surrounding hyphens). Strip that directive before counting so removing an
// unnecessary/incorrect @ts-expect-error comment — a real lint fix — isn't misread as
// deleting a test assertion. Applied symmetrically to both sides of the diff.
const ASSERT_RE = /\b(assert(?:\.\w+)?|expect|\.toBe|\.toEqual|\.toThrow|t\.ok|t\.equal)\b/g;
const stripTsDirectives = (s) => s.replace(/@ts-expect-error/g, '');
const testFiles = files.filter((f) => /\.(test|behavior|spec)\.(js|mjs|cjs|ts|tsx)$/.test(f) || /\/tests?\//.test(f) && /\.(js|mjs|ts|tsx)$/.test(f));
for (const f of testFiles) {
  // Shell-injection fix (command-injection detector, authorized 2026-07-25).
  // These two reads used to go through `run()`, which passes a STRING to
  // execSync — i.e. a shell. `f` comes from `git diff --name-only`, so a file
  // committed with a name like `$(...)` or containing backticks would have
  // EXECUTED on the next guard run. The old quoting made it worse than it
  // looked: `JSON.stringify(f).slice(1,-1)` stripped the quotes back off, so
  // the git path interpolated completely unquoted; and `"..."` around the
  // `cat` arg stops word-splitting but NOT `$(...)`/backtick expansion, which
  // bash performs inside double quotes.
  //
  // Both now avoid a shell entirely: execFileSync takes an argv array (the
  // path is one argument, never parsed), and the working-tree read is plain
  // fs — shelling out to `cat` bought nothing. Ironic bug to leave in the
  // anti-gaming gate itself, which is exactly why it's fixed rather than
  // annotated.
  let head;
  try {
    head = { ok: true, out: execFileSync("git", ["show", `HEAD:${f}`], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch {
    continue; // new test file (not in HEAD) — fine
  }
  let cur;
  try {
    cur = readFileSync(resolve(REPO, f), "utf8");
  } catch {
    continue; // deleted in the working tree — nothing to compare
  }
  const before = (stripTsDirectives(head.out).match(ASSERT_RE) || []).length;
  const after = (stripTsDirectives(cur).match(ASSERT_RE) || []).length;
  if (after < before) violations.push(`TEST WEAKENED: ${f} assertions ${before}→${after} (removing/weakening assertions is gaming — add, don't subtract)`);
}

if (violations.length === 0) {
  console.log(ok("guard: clean") + ` — ${files.length} changed files, no protected/invariant/weakened-test edits`);
  process.exit(0);
}

console.log(bad("guard: BLOCKED") + " — the diff games a metric or touches an escalation file:\n");
for (const v of violations) console.log("  " + warn("✗") + " " + v);
console.log("\n" + bad("Do NOT commit.") + " Re-do the unit doing the real work; for invariant edits, escalate to a human.");
process.exit(1);
