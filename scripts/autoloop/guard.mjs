// scripts/autoloop/guard.mjs
// AUTOMATED anti-gaming gate. Run before every commit the loop makes. Rejects the
// wave (exit 1) — NO human needed — if the diff games a metric. This is the
// structural reward-hacking cure that must survive "maximize autonomy": the SWE-bench
// reward-hacking literature shows agents game graders, hardcode to visible tests, and
// weaken assertions; this gate makes those moves un-committable.
//
// Usage: node scripts/autoloop/guard.mjs            (inspects the working diff vs HEAD)
// Exit 0 = clean to commit. Exit 1 = blocked (reason printed).

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
const ASSERT_RE = /\b(assert(?:\.\w+)?|expect|\.toBe|\.toEqual|\.toThrow|t\.ok|t\.equal)\b/g;
const testFiles = files.filter((f) => /\.(test|behavior|spec)\.(js|mjs|cjs|ts|tsx)$/.test(f) || /\/tests?\//.test(f) && /\.(js|mjs|ts|tsx)$/.test(f));
for (const f of testFiles) {
  const head = run(`git show HEAD:${JSON.stringify(f).slice(1, -1)}`, { allowFail: true });
  if (!head.ok) continue; // new test file — fine
  const cur = run(`cat ${JSON.stringify(f)}`).out;
  const before = (head.out.match(ASSERT_RE) || []).length;
  const after = (cur.match(ASSERT_RE) || []).length;
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
