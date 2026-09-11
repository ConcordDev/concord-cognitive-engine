#!/usr/bin/env node
// concord-frontend/scripts/ci-test-coverage-tolerant.mjs
//
// CI-only wrapper around `vitest run --coverage`. Mirrors
// server/scripts/ci-test-tolerant.mjs's philosophy exactly: tolerate ONE
// narrow, well-identified class of environmental noise, never a real
// failure, and be loud about which one fired.
//
// ── The bug this tolerates (root-caused 2026-09-11) ─────────────────────────
// Vitest 4.1.x has an open upstream race in its worker-pool teardown: a
// pending `onUserConsoleLog` RPC round-trip can lose the race against the
// worker's rpc channel closing, surfacing as:
//
//   ⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
//   EnvironmentTeardownError: [vitest-worker]: Closing rpc while
//   "onUserConsoleLog" was pending
//
// Confirmed via direct comparison across two consecutive real CI runs on
// this exact PR, same suite, no relevant code changed in between: run 1
// printed `Test Files 982 passed (982)` / `Tests 8002 passed | 1 skipped`
// with exit 0; run 2 printed the IDENTICAL pass counts but exit 1, with
// this exact EnvironmentTeardownError as the only difference. Also
// confirmed as a known, currently-open upstream issue (not specific to
// this repo): vitest-dev/vitest#8649, #9872, #9736 all describe the same
// "tests pass, run ends with errors" shape for this exact RPC-teardown
// race, introduced by the Vitest 4 worker-pool rework.
//
// ── Why this is a counting check, not a block-parsing one ──────────────────
// An earlier version of this script tried to split vitest's tail output on
// "⎯⎯⎯⎯ Unhandled X ⎯⎯⎯⎯" dividers and check each fragment's text against
// the known signature. That's WRONG and was caught before shipping: a
// separate, real failure earlier in this same investigation (a
// RolldownError crash while remapping coverage for lib/p2p-dtu.ts, since
// fixed by excluding that file — see vitest.config.ts) printed its OWN
// raw stack trace OUTSIDE any "Unhandled ..." divider (vitest's coverage
// step throws it directly, not via its unhandled-rejection handler), while
// the SAME gather-tools-carry.test.ts race was ALSO present in that run's
// output. A naive divider-block check either flags both runs as
// unrecognized (the generic "Unhandled Errors" plural summary banner
// matches nothing) or, worse, could tolerate the real RolldownError crash
// too (its text sits right next to a real "Closing rpc" occurrence).
// Verified directly against both real captured CI logs before shipping.
//
// The correct, robust check has two independent parts:
//   1. An explicit, always-fatal scan for ANY coverage-generation crash
//      signature (a RolldownError, or vitest's own "Failed to parse
//      file://... Excluding it from coverage" warning that precedes one).
//      This is not something to ever tolerate — it means the coverage
//      report itself is incomplete, and if a NEW file ever hits this, it
//      needs the same investigate-and-exclude treatment lib/p2p-dtu.ts got,
//      not a silent pass.
//   2. Vitest itself reports an authoritative count — "Vitest caught N
//      unhandled error(s) during the test run." Count how many times the
//      KNOWN_TOLERABLE_ERROR text actually occurs in the output; tolerate
//      only when that count equals N (every reported issue is the known
//      one, none are a mystery third thing).
//
// ── What this does NOT tolerate ──────────────────────────────────────────
// - Any `Test Files N failed` or `Tests N failed` (N > 0) — a real
//   assertion failure.
// - Any coverage threshold violation (`ERROR: Coverage for ... does not
//   meet threshold`) — a real regression.
// - Any coverage-generation crash signature (RolldownError / "Failed to
//   parse file... Excluding it from coverage") — always fatal, see above.
// - A run where the unhandled-error count doesn't exactly match the
//   number of KNOWN_TOLERABLE_ERROR occurrences — an unrecognized failure
//   mode is never assumed safe.
// - A process that never reaches Vitest's own summary line at all (e.g. an
//   OOM crash) — no summary means no verdict, never a pass.
//
// `npm run test:coverage` (the raw, non-wrapped script) is unchanged and
// stays what local dev and any other CI caller uses — this wrapper is
// opt-in, invoked only from the one CI step that hit this.

import { spawn } from "node:child_process";

const KNOWN_TOLERABLE_ERROR = /\[vitest-worker\]: Closing rpc while ".*?" was pending/g;
const COVERAGE_CRASH_SIGNATURES = [
  /Error \[RolldownError\]/,
  /Failed to parse file:\/\/.*?\. Excluding it from coverage\./,
];

function run() {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["vitest", "run", "--coverage", "--exclude=**/tests/smoke/**"],
      { stdio: ["inherit", "pipe", "pipe"], shell: false },
    );
    let out = "";
    child.stdout.on("data", (d) => { process.stdout.write(d); out += d.toString(); });
    child.stderr.on("data", (d) => { process.stderr.write(d); out += d.toString(); });
    child.on("close", (code) => resolve({ code, out }));
    child.on("error", (err) => resolve({ code: 1, out: out + `\n[wrapper] spawn error: ${err.message}\n` }));
  });
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function main() {
  const { code, out } = await run();
  if (code === 0) {
    process.exit(0);
  }

  const clean = stripAnsi(out);

  // Real assertion failures — never tolerated, regardless of anything else.
  const testFilesFailed = clean.match(/Test Files\s+(\d+)\s+failed/);
  const testsFailed = clean.match(/(?<!\d)Tests\s+(\d+)\s+failed/);
  if ((testFilesFailed && Number(testFilesFailed[1]) > 0) ||
      (testsFailed && Number(testsFailed[1]) > 0)) {
    console.error("\n[ci-tolerant] Real test failure(s) detected — not tolerated.");
    process.exit(code);
  }

  // Real coverage-threshold violations — never tolerated.
  if (/ERROR: Coverage for .* does not meet/i.test(clean)) {
    console.error("\n[ci-tolerant] Coverage threshold violation — not tolerated.");
    process.exit(code);
  }

  // Coverage-generation crashes (e.g. the lib/p2p-dtu.ts RolldownError this
  // repo already hit once) — always fatal. Never tolerated, even if it sits
  // next to an otherwise-tolerable unhandled-rejection count match.
  for (const sig of COVERAGE_CRASH_SIGNATURES) {
    if (sig.test(clean)) {
      console.error(`\n[ci-tolerant] Coverage-generation crash detected (${sig}) — not tolerated. ` +
        "A new file needs the same investigate-and-exclude treatment as lib/p2p-dtu.ts (see vitest.config.ts).");
      process.exit(code);
    }
  }

  // Must have actually reached Vitest's own summary — a crash with no
  // summary is never a pass, no matter what else matches.
  const filesPassed = clean.match(/Test Files\s+(\d+)\s+passed/);
  if (!filesPassed) {
    console.error("\n[ci-tolerant] No 'Test Files ... passed' summary found — the run did not complete. Not tolerated.");
    process.exit(code);
  }

  // The authoritative count-match check: every unhandled error/rejection
  // Vitest itself reports must be the known, tolerable one — no more, no
  // fewer. A mismatch (a mystery extra issue, or a claimed count vitest
  // didn't actually substantiate) is never tolerated.
  const caughtMatch = clean.match(/Vitest caught (\d+) unhandled error/);
  const caughtCount = caughtMatch ? Number(caughtMatch[1]) : 0;
  const tolerableCount = (clean.match(KNOWN_TOLERABLE_ERROR) || []).length;
  if (caughtCount === 0 || tolerableCount !== caughtCount) {
    console.error(
      `\n[ci-tolerant] Unhandled-error count mismatch (vitest reported ${caughtCount}, ` +
      `${tolerableCount} matched the known signature) — not tolerated.`,
    );
    process.exit(code);
  }

  console.warn(
    "\n[ci-tolerant] Tolerating a known upstream Vitest worker-pool teardown race " +
    "([vitest-worker]: Closing rpc while \"...\" was pending — vitest-dev/vitest#8649, " +
    `#9872, #9736), ${tolerableCount}/${caughtCount} reported issue(s) matched. Real test results: ` +
    filesPassed[0] + ". See this script's header for the full mechanism.",
  );
  process.exit(0);
}

main();
