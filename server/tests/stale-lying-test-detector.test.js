// tests/stale-lying-test-detector.test.js
//
// Proves the stale-lying-test detector fires on the REAL bug it was seeded
// from — `concord-frontend/tests/command-palette-wired.test.tsx`'s
// "wires run-mode start dispatches via the GameModesHotbarGroup" test, which
// only regex-matched two source files for a string and a call signature and
// would have passed even if the palette never dispatched anything (which it
// didn't, until the verification-audit Fix 7 in commit 75d46fb4) — and does
// NOT fire on the fixed version of the same file (real render/fireEvent/
// dispatchEvent assertions) or on a legitimately static-only test (a title
// with no behavior claim, e.g. "exports the correct constant").
//
// Fixtures under tests/fixtures/stale-lying-test/ are the REAL before/after
// file content pulled via `git show 75d46fb4^:...` / `git show 75d46fb4:...`
// (see file headers) plus one hand-authored legitimate-static fixture.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runStaleLyingTestDetector,
  extractBalanced,
  collectFileVars,
  collectAssertionSpans,
  collectRuntimeSpans,
  findTestBlocks,
  findEnclosingDescribeTitle,
} from "../lib/detectors/stale-lying-test-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "stale-lying-test");

async function fixture(name) {
  return readFile(path.join(FIXTURES, name), "utf8");
}

/** Builds a fake repo with a concord-frontend/tests/ tree (the detector only walks concord-frontend/). */
async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stale-lying-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, "concord-frontend", rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

describe("stale-lying-test detector — pure helpers", () => {
  it("extractBalanced matches parens/braces and ignores delimiters inside strings", () => {
    const src = "foo(a, ')', { x: 1 })";
    const open = src.indexOf("(");
    assert.equal(extractBalanced(src, open, "(", ")"), "(a, ')', { x: 1 })");
  });

  it("collectFileVars tracks readFileSync targets and excludes non-source extensions", () => {
    const src = [
      `const P = path.resolve(__dirname, '..', 'Foo.tsx');`,
      `const CFG = path.resolve(__dirname, '..', 'data.json');`,
      `const src = readFileSync(P, 'utf8');`,
      `const cfg = readFileSync(CFG, 'utf8');`,
    ].join("\n");
    const vars = collectFileVars(src, "self.test.tsx");
    assert.ok(vars.has("src"), "source-file readFileSync tracked");
    assert.ok(!vars.has("cfg"), "json readFileSync excluded as non-source");
  });

  it("collectAssertionSpans finds expect(x).toMatch(...) only when x is a tracked var", () => {
    const src = `const src = readFileSync(P,'utf8');\nexpect(src).toMatch(/foo/);\nexpect(other).toMatch(/bar/);`;
    const vars = new Set(["src"]);
    const spans = collectAssertionSpans(src, vars);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].var, "src");
  });

  it("collectRuntimeSpans excludes JSX-looking text embedded inside an assertion span", () => {
    const src = `expect(src).toMatch(/<Foo \\/>/);`;
    const assertionSpans = [{ start: 0, end: src.length, var: "src" }];
    const runtime = collectRuntimeSpans(src, assertionSpans);
    assert.equal(runtime.length, 0, "the <Foo> inside the regex literal must not count as real JSX render");
  });

  it("collectRuntimeSpans DOES flag a real render(...) call outside any assertion span", () => {
    const src = `render(<Foo isOpen={true} />);`;
    const runtime = collectRuntimeSpans(src, []);
    assert.ok(runtime.length >= 1);
  });

  it("findTestBlocks extracts title + span, ignoring RegExp#test( ) calls", () => {
    const src = `RE.test(str);\nit('does a thing', () => { doStuff(); });`;
    const blocks = findTestBlocks(src);
    assert.equal(blocks.length, 1, "RE.test(str) must not be mistaken for an it()/test() block");
    assert.equal(blocks[0].title, "does a thing");
  });

  it("findEnclosingDescribeTitle finds the nearest wrapping describe", () => {
    const src = `describe('Outer wires stuff', () => {\n  it('inner', () => {});\n});`;
    const itIdx = src.indexOf("it(");
    assert.equal(findEnclosingDescribeTitle(src, itIdx), "Outer wires stuff");
  });
});

describe("stale-lying-test detector — end to end", () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("FIRES on the real pre-fix command-palette-wired.test.tsx (source-string-only 'wires...dispatches' test)", async () => {
    const before = await fixture("before-command-palette-wired.fixture");
    dir = await tmpRepo({ "tests/command-palette-wired.test.tsx": before });

    const r = await runStaleLyingTestDetector({ root: dir });
    assert.equal(r.ok, true);
    const real = r.findings.filter((f) => f.id === "stale_lying_test");
    assert.ok(real.length >= 1, `expected at least one finding, got: ${JSON.stringify(r.findings)}`);
    assert.ok(
      real.some((f) => /wires run-mode start dispatches/i.test(f.evidence.title)),
      "must flag the specific lying test by name"
    );
    assert.match(real[0].location, /command-palette-wired\.test\.tsx/);
    assert.equal(real[0].severity, "medium");

    // The OTHER its in the same file (no behavior-claim title, e.g. "binds
    // Ctrl+K and Cmd+K", "reads lenses from the canonical lens-registry")
    // must NOT be flagged — precision check within the same file.
    assert.ok(
      !real.some((f) => /binds Ctrl\+K/i.test(f.evidence.title)),
      "a test with no behavior-claim title must not be flagged"
    );
  });

  it("does NOT fire on the real post-fix command-palette-wired.test.tsx (render/fireEvent/dispatchEvent test)", async () => {
    const after = await fixture("after-command-palette-wired.fixture");
    dir = await tmpRepo({ "tests/command-palette-wired.test.tsx": after });

    const r = await runStaleLyingTestDetector({ root: dir });
    assert.equal(r.ok, true);
    const real = r.findings.filter((f) => f.id === "stale_lying_test");
    assert.equal(real.length, 0, `fixed file must have zero findings, got: ${JSON.stringify(real)}`);
  });

  it("does NOT fire on a legitimate static-only test (title has no behavior claim)", async () => {
    const legit = await fixture("legit-static-config.fixture");
    dir = await tmpRepo({ "tests/feature-flags-constants.test.ts": legit });

    const r = await runStaleLyingTestDetector({ root: dir });
    assert.equal(r.ok, true);
    const real = r.findings.filter((f) => f.id === "stale_lying_test");
    assert.equal(real.length, 0, `legitimate static assertion must not be flagged, got: ${JSON.stringify(real)}`);
  });

  it("returns 0 findings on an empty test file", async () => {
    dir = await tmpRepo({ "tests/empty.test.tsx": "" });
    const r = await runStaleLyingTestDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.findings.filter((f) => f.id === "stale_lying_test").length, 0);
  });

  it("never throws — returns ok:true when concord-frontend/ doesn't exist at all", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "stale-lying-empty-"));
    const r = await runStaleLyingTestDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total >= 1, true, "still emits the info summary finding");
  });
});
