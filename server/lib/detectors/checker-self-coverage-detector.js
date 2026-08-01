// server/lib/detectors/checker-self-coverage-detector.js
//
// A meta-detector: it doesn't look for bugs in application code, it looks for
// bugs in the THINGS THAT LOOK FOR BUGS. Seeded by two real, confirmed
// instances found in one CI-debugging session (2026-07-31), neither of which
// showed up as a "failing test" until someone tripped over their symptom:
//   1. lib/ssrf-guard.js#fetchWithPinnedIp imported undici directly and
//      called its fetch, bypassing globalThis.fetch entirely — silently
//      defeating tests/preload/no-egress.mjs's test-isolation guard for
//      every macro routed through it. No test asserted "no-egress actually
//      blocks fetches reached via the SSRF-guarded path", so nothing caught
//      it until ~40 unrelated tests started intermittently making real
//      network calls.
//   2. tests/invariants/emit-subscribe-pairing.test.js's own
//      collectSubscribes() truncated its SocketEvent-union parse at the
//      first semicolon — which happened to sit inside a `//` comment —
//      silently dropping every union member declared after it and
//      misreporting 27 real, subscribed events as dead.
// Both are the same failure shape: a checker (a test-isolation guard, a
// detection regex) with no test proving IT works, in either direction. This
// detector doesn't re-derive whether any specific checker is currently
// buggy — that's undecidable by cross-referencing test presence — it
// verifies the CHEAPER, sufficient precondition: does a pinning test exist
// at all. "No test imports this checker" is exactly the condition that let
// both bugs above go unnoticed for as long as they did.
//
// Scope: every file in server/lib/detectors/*.js (excluding framework/
// registry infrastructure) and every scripts/*.mjs file whose name matches
// the audit/check/verify/grade gate-script convention already used across
// this repo's own CI (scripts/audit-*.mjs, scripts/check-*.mjs,
// scripts/verify-*.mjs, scripts/grade-*.mjs).

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, walk } from "./_framework.js";

const INFRA_DETECTOR_FILES = new Set(["_framework.js", "index.js", "baseline.js"]);
const GATE_SCRIPT_RE = /^(audit|check|verify|grade)-.+\.mjs$/;

export async function runCheckerSelfCoverageDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("checker-self-coverage", "no_root", null, t0);
  try {
    // 1. Enumerate checkers.
    const detectorDir = path.join(root, "server", "lib", "detectors");
    const detectorFiles = (await walk(detectorDir, [".js"]))
      .filter((f) => !INFRA_DETECTOR_FILES.has(path.basename(f)));

    const scriptsDir = path.join(root, "scripts");
    const scriptFiles = (await walk(scriptsDir, [".mjs"]))
      .filter((f) => GATE_SCRIPT_RE.test(path.basename(f)));

    // 2. Build a haystack of ALL test file contents (server/tests + repo-root
    // tests + concord-frontend/tests, matching this repo's actual test tree
    // shape) to substring-match checker basenames against.
    const testDirs = [
      path.join(root, "server", "tests"),
      path.join(root, "tests"),
      path.join(root, "concord-frontend", "tests"),
    ];
    let testBlob = "";
    let testFileCount = 0;
    for (const dir of testDirs) {
      const files = await walk(dir, [".js", ".ts", ".tsx", ".mjs"]);
      testFileCount += files.length;
      for (const f of files) testBlob += "\n" + (await readSafe(f));
    }

    const findings = [];
    let uncoveredDetectors = 0, uncoveredScripts = 0;

    for (const f of detectorFiles) {
      const base = path.basename(f, ".js");
      const rel = relPath(root, f);
      // A checker is "covered" if any test file's content references its
      // basename (import path or the exported run-function pattern the
      // registry uses: runXyzDetector).
      const covered = testBlob.includes(`detectors/${base}`) || testBlob.includes(`detectors/${base}.js`);
      if (!covered) {
        uncoveredDetectors++;
        findings.push({
          id: "checker_no_pinning_test_detector",
          severity: "medium",
          kind: "static",
          category: "quality",
          subject: { kind: "file", path: rel },
          message: `${rel} has no test anywhere in the tree importing it — a bidirectional bug in this detector (false positive OR false negative) has nothing to catch it`,
          location: `${rel}:1`,
          evidence: { detector: base },
          fixHint: "add_bidirectional_pinning_test_for_detector",
        });
      }
    }

    for (const f of scriptFiles) {
      const base = path.basename(f, ".mjs");
      const rel = relPath(root, f);
      const covered = testBlob.includes(base);
      if (!covered) {
        uncoveredScripts++;
        findings.push({
          id: "checker_no_pinning_test_script",
          severity: "medium",
          kind: "static",
          category: "quality",
          subject: { kind: "file", path: rel },
          message: `${rel} (a gate/audit script) has no test anywhere in the tree referencing it — its own correctness is unverified`,
          location: `${rel}:1`,
          evidence: { script: base },
          fixHint: "add_pinning_test_invoking_this_gate_script",
        });
      }
    }

    findings.unshift({
      id: "checker_self_coverage_summary",
      severity: "info",
      kind: "static",
      category: "quality",
      message: `${detectorFiles.length} detector(s) + ${scriptFiles.length} gate script(s) checked against ${testFileCount} test file(s): ${uncoveredDetectors} detector(s) and ${uncoveredScripts} script(s) have no referencing test`,
      evidence: { detectorFiles: detectorFiles.length, scriptFiles: scriptFiles.length, testFileCount, uncoveredDetectors, uncoveredScripts },
    });

    return makeReport("checker-self-coverage", findings, t0);
  } catch (err) {
    return makeError("checker-self-coverage", "exception", err, t0);
  }
}
