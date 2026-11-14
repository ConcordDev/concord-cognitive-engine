// FIX-frontier-007 — the Const-Time summary's coverage accounting.
//
// A default run against this repo reported "Scanned 3,413 of 6,682
// candidate file(s); flagged 0 pattern(s)" and read as a clean result
// at 51% coverage. In fact the gap was mostly files excluded BY
// DESIGN (test/spec files, test fixtures, the detector suite's own
// sources) — but the summary lumped exclusions, unreadable files,
// and a findings-cap early stop into one unexplained fraction, so a
// complete run and a genuinely partial run read identically. The
// summary now accounts for every candidate file and flags a cap
// stop as PARTIAL COVERAGE in words.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConstantTimeDetector } from "../lib/detectors/constant-time-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "consttime-cov-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, "server", rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

const CLEAN = "export function add(a, b) { return a + b; }\n";

function summaryOf(report) {
  const s = report.findings.find((f) => f.id === "constant_time_summary");
  assert.ok(s, "summary finding present");
  return s;
}

describe("constant-time coverage summary (FIX-frontier-007)", () => {
  it("accounts for by-design exclusions instead of reading as partial coverage", async () => {
    const dir = await tmpRepo({
      "lib/a.js": CLEAN,
      "lib/b.test.js": CLEAN,
      "tests/fixtures/c.js": CLEAN,
      "lib/detectors/d.js": CLEAN,
    });
    const r = await runConstantTimeDetector({ root: dir });
    assert.equal(r.ok, true);
    const s = summaryOf(r);
    assert.deepEqual(
      { scanned: s.evidence.scanned, totalFiles: s.evidence.totalFiles, skipped: s.evidence.skipped, capped: s.evidence.capped },
      { scanned: 1, totalFiles: 4, skipped: 3, capped: false },
    );
    assert.match(s.message, /excluded by design/);
    assert.doesNotMatch(s.message, /PARTIAL COVERAGE/);
  });

  it("a fully scanned tree needs no coverage caveat", async () => {
    const dir = await tmpRepo({ "lib/a.js": CLEAN, "lib/b.js": CLEAN });
    const r = await runConstantTimeDetector({ root: dir });
    const s = summaryOf(r);
    assert.equal(s.evidence.scanned, 2);
    assert.equal(s.evidence.totalFiles, 2);
    assert.doesNotMatch(s.message, /Coverage:/);
  });

  it("a findings-cap stop is flagged PARTIAL COVERAGE, never a clean result", async () => {
    const vulnerable = await readFile(path.join(__dirname, "fixtures", "constant-time", "vulnerable-compare.js"), "utf8");
    const files = {};
    for (let i = 0; i < 510; i++) files[`lib/vuln-${i}.js`] = vulnerable;
    const dir = await tmpRepo(files);
    const r = await runConstantTimeDetector({ root: dir });
    const s = summaryOf(r);
    assert.equal(s.evidence.capped, true);
    assert.match(s.message, /PARTIAL COVERAGE/);
    assert.ok(
      s.evidence.scanned + s.evidence.skipped + s.evidence.unreadable < s.evidence.totalFiles,
      "some candidates were never reached",
    );
  });
});
