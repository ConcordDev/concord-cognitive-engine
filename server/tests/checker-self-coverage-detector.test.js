// tests/checker-self-coverage-detector.test.js
//
// Bidirectional pin: a detector/gate-script with no referencing test must be
// flagged; the same one WITH a referencing test must not be.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCheckerSelfCoverageDetector } from "../lib/detectors/checker-self-coverage-detector.js";

async function tmpRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csc-"));
  await mkdir(path.join(dir, "server", "lib", "detectors"), { recursive: true });
  await mkdir(path.join(dir, "server", "tests"), { recursive: true });
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  // Infra files that must be excluded from the checker set.
  await writeFile(path.join(dir, "server", "lib", "detectors", "_framework.js"), "// infra", "utf8");
  await writeFile(path.join(dir, "server", "lib", "detectors", "index.js"), "// infra", "utf8");
  return dir;
}

describe("checker-self-coverage detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS a detector file with no referencing test anywhere", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "lib", "detectors", "orphan-detector.js"), "export function runOrphanDetector(){}", "utf8");
    await writeFile(path.join(dir, "server", "tests", "unrelated.test.js"), "// nothing referencing orphan-detector here", "utf8");
    const r = await runCheckerSelfCoverageDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "checker_no_pinning_test_detector");
    assert.ok(hit, "orphan-detector.js must be flagged");
    assert.equal(hit.evidence.detector, "orphan-detector");
  });

  it("does NOT flag a detector file a real test file imports", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "lib", "detectors", "covered-detector.js"), "export function runCoveredDetector(){}", "utf8");
    await writeFile(
      path.join(dir, "server", "tests", "covered.test.js"),
      `import { runCoveredDetector } from "../lib/detectors/covered-detector.js";`,
      "utf8"
    );
    const r = await runCheckerSelfCoverageDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.detector === "covered-detector");
    assert.equal(hit, undefined, "a detector a test file imports must not be flagged");
  });

  it("FLAGS a gate script (audit-/check-/verify-/grade- prefixed) with no referencing test", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "scripts", "audit-orphan-gate.mjs"), "// gate script", "utf8");
    await writeFile(path.join(dir, "server", "tests", "unrelated2.test.js"), "// nothing here either", "utf8");
    const r = await runCheckerSelfCoverageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "checker_no_pinning_test_script");
    assert.ok(hit);
    assert.equal(hit.evidence.script, "audit-orphan-gate");
  });

  it("does NOT flag a gate script a test file's execFileSync path references", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "scripts", "check-covered-gate.mjs"), "// gate script", "utf8");
    await writeFile(
      path.join(dir, "server", "tests", "gate.test.js"),
      `const SCRIPT = path.resolve(HERE, "../../../scripts/check-covered-gate.mjs");`,
      "utf8"
    );
    const r = await runCheckerSelfCoverageDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.script === "check-covered-gate");
    assert.equal(hit, undefined);
  });

  it("does NOT treat a non-gate-shaped script (e.g. a plain helper) as a checker requiring coverage", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "scripts", "unrelated-helper.mjs"), "// not a gate script", "utf8");
    const r = await runCheckerSelfCoverageDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.script === "unrelated-helper");
    assert.equal(hit, undefined, "only audit-/check-/verify-/grade- prefixed scripts count as gate scripts");
  });
});
