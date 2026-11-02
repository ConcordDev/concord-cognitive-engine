// scripts/ci/full-suite-shard.mjs + full-suite-diff.mjs: the logic behind the sharded full-suite workflow.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assignShards, listTestFiles } from "../../scripts/ci/full-suite-shard.mjs";
import { parseJunit, classify, buildReport, renderMarkdown } from "../../scripts/ci/full-suite-diff.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const diffCli = path.resolve(here, "../../scripts/ci/full-suite-diff.mjs");

const tc = (file, name, extra = "") => (extra
  ? `<testcase name="${name}" time="0.1" classname="test" file="/runner/work/repo/repo/server/tests/${file}">${extra}</testcase>`
  : `<testcase name="${name}" time="0.1" classname="test" file="/runner/work/repo/repo/server/tests/${file}"/>`);
const suite = (name, cases) => `<testsuite name="${name}" tests="${cases.length}">${cases.join("\n")}</testsuite>`;
const doc = (...suites) => `<?xml version="1.0"?><testsuites>${suites.join("\n")}</testsuites>`;
const fail = (msg) => `<failure type="testCodeFailure" message="${msg}">stack</failure>`;

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "fs-diff-")); }

describe("sharding", () => {
  it("every file lands in exactly one shard, deterministically", () => {
    const files = Array.from({ length: 101 }, (_, i) => `tests/f${i}.test.js`);
    const size = (f) => (Number(f.match(/\d+/)[0]) * 37) % 11 + 1;
    const a = assignShards(files, 7, size);
    const b = assignShards([...files].reverse(), 7, size);
    assert.deepEqual(a, b);
    const flat = a.flat();
    assert.equal(flat.length, files.length);
    assert.equal(new Set(flat).size, files.length);
  });

  it("balances load: heaviest shard is within one largest-file of the lightest", () => {
    const sizes = new Map(Array.from({ length: 200 }, (_, i) => [`t${i}`, (i * 7919) % 97 + 1]));
    const bins = assignShards([...sizes.keys()], 8, (f) => sizes.get(f));
    const loads = bins.map((b) => b.reduce((s, f) => s + sizes.get(f), 0));
    assert.ok(Math.max(...loads) - Math.min(...loads) <= Math.max(...sizes.values()));
  });

  it("the real tests dir is fully covered with the same globs as test:main", () => {
    const root = path.resolve(here, "..");
    const files = listTestFiles(root);
    assert.ok(files.length > 1000);
    assert.ok(files.every((f) => f.startsWith("tests/") && (f.endsWith(".test.js") || f.endsWith("-tests.js"))));
    assert.ok(files.includes("tests/ci-full-suite-scripts.test.js"));
  });
});

describe("parseJunit", () => {
  it("finds failures with file, nested suite path and message; unescapes entities", () => {
    const xml = doc(
      suite("outer", [tc("a.test.js", "ok one"), tc("a.test.js", "it &lt;breaks&gt; &amp; fails", fail("expected 1 &amp; got 2\nline2"))]),
      suite("other", [tc("b.test.js", "skipped one", "<skipped/>")]),
    );
    const r = parseJunit(xml);
    assert.equal(r.total, 3);
    assert.equal(r.passed, 1);
    assert.equal(r.skipped, 1);
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].id, "server/tests/a.test.js :: outer :: it <breaks> & fails");
    assert.equal(r.failures[0].message, "expected 1 & got 2");
  });

  it("handles nested testsuites and error elements, and vitest-style classname paths", () => {
    const xml = `<testsuites><testsuite name="tests/x.test.tsx"><testsuite name="MemoryPanel">
      <testcase classname="tests/settings/memory-panel.test.tsx" name="a &gt; b"><error message="boom"/></testcase>
      <testcase classname="tests/settings/memory-panel.test.tsx" name="fine"/></testsuite></testsuite></testsuites>`;
    const r = parseJunit(xml, { prefix: "fe:" });
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].id, "fe:tests/settings/memory-panel.test.tsx :: tests/x.test.tsx > MemoryPanel :: a > b");
    assert.equal(r.passed, 1);
  });
});

describe("classify", () => {
  const cur = ["A", "B", "C"];
  it("splits NEW vs PRE-EXISTING vs fixed against a baseline", () => {
    const c = classify(cur, ["B", "C", "D"]);
    assert.deepEqual(c.newFailures, ["A"]);
    assert.deepEqual(c.preExisting, ["B", "C"]);
    assert.deepEqual(c.fixed, ["D"]);
  });
  it("without a baseline nothing is called NEW or PRE-EXISTING", () => {
    const c = classify(cur, null);
    assert.deepEqual(c.newFailures, []);
    assert.deepEqual(c.unattributed, ["A", "B", "C"]);
  });
  it("flaky ids (passed on isolated re-run) are neither NEW nor PRE-EXISTING", () => {
    const c = classify(["A", "B"], ["B"], new Set(["A"]));
    assert.deepEqual(c.newFailures, []);
    assert.deepEqual(c.preExisting, ["B"]);
    assert.deepEqual(c.flaky, ["A"]);
  });
});

describe("report over a directory", () => {
  it("merges shards, attributes against the baseline, detects flakes and missing shards, and exits 1 only for NEW", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "junit-shard-1.xml"), doc(suite("s", [
      tc("a.test.js", "old failure", fail("x")), tc("a.test.js", "new failure", fail("y")), tc("a.test.js", "flake", fail("z")), tc("a.test.js", "fine"),
    ])));
    fs.writeFileSync(path.join(dir, "junit-shard-1-rerun.xml"), doc(suite("s", [tc("a.test.js", "old failure", fail("x")), tc("a.test.js", "new failure", fail("y")), tc("a.test.js", "flake")])));
    const baselinePath = path.join(dir, "base.json");
    fs.writeFileSync(baselinePath, JSON.stringify({ failing: ["server/tests/a.test.js :: s :: old failure", "server/tests/a.test.js :: s :: gone"] }));
    const out = path.join(dir, "failing.json");
    const summary = path.join(dir, "summary.md");
    const r = spawnSync(process.execPath, [diffCli, "report", "--dir", dir, "--baseline", baselinePath, "--expect-shards", "2", "--summary", summary, "--out", out]);
    assert.equal(r.status, 1);
    const md = fs.readFileSync(summary, "utf8");
    assert.match(md, /NEW failures \(1\)/);
    assert.match(md, /new failure/);
    assert.match(md, /PRE-EXISTING failures \(1\)/);
    assert.match(md, /Flaky.*\(1\)/);
    assert.match(md, /INCOMPLETE:\*\* shard\(s\) 2/);
    assert.match(md, /Fixed vs main \(1\)/);
    const j = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(j.failing.length, 3);
    assert.deepEqual(j.incomplete, [2]);
  });

  it("exits 0 when every failure also fails on main", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "junit-shard-1.xml"), doc(suite("s", [tc("a.test.js", "old", fail("x"))])));
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ failing: ["server/tests/a.test.js :: s :: old"] }));
    const r = spawnSync(process.execPath, [diffCli, "report", "--dir", dir, "--baseline", path.join(dir, "base.json"), "--expect-shards", "1"]);
    assert.equal(r.status, 0);
  });

  it("with no baseline it never claims NEW, says so, and exits 0", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "junit-shard-1.xml"), doc(suite("s", [tc("a.test.js", "boom", fail("x"))])));
    const r = spawnSync(process.execPath, [diffCli, "report", "--dir", dir, "--expect-shards", "1"]);
    assert.equal(r.status, 0);
    assert.match(String(r.stdout), /No baseline/);
    assert.match(String(r.stdout), /unattributed \(1\)/);
  });

  it("failing-files lists each failing test file once (feeds the isolated re-run)", () => {
    const dir = tmp();
    const f = path.join(dir, "j.xml");
    fs.writeFileSync(f, doc(suite("s", [tc("a.test.js", "1", fail("x")), tc("a.test.js", "2", fail("x")), tc("b.test.js", "3", fail("x")), tc("c.test.js", "4")])));
    const r = spawnSync(process.execPath, [diffCli, "failing-files", "--junit", f]);
    assert.equal(String(r.stdout), "server/tests/a.test.js\nserver/tests/b.test.js\n");
  });

  it("buildReport + renderMarkdown on an empty dir are honest (0 tests, expected shards missing)", () => {
    const dir = tmp();
    const rep = buildReport({ dir, baseline: [], expectShards: 3 });
    assert.deepEqual(rep.missingShards, [1, 2, 3]);
    assert.match(renderMarkdown(rep), /INCOMPLETE/);
  });
});

describe("baseline hygiene", () => {
  it("--complete-only does not write a baseline file when a shard is missing", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "junit-shard-1.xml"), doc(suite("s", [tc("a.test.js", "ok")])));
    const out = path.join(dir, "failing.json");
    const r = spawnSync(process.execPath, [diffCli, "report", "--dir", dir, "--expect-shards", "2", "--out", out, "--complete-only"]);
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(out), false);
    const ok = spawnSync(process.execPath, [diffCli, "report", "--dir", dir, "--expect-shards", "1", "--out", out, "--complete-only"]);
    assert.equal(ok.status, 0);
    assert.equal(fs.existsSync(out), true);
  });
});
