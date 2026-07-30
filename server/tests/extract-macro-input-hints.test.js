// server/tests/extract-macro-input-hints.test.js
//
// Unit-tests scripts/extract-macro-input-hints.mjs's pure parsing core
// directly against literal fixture source strings (not real repo files) —
// covering the comment-style variety actually found across
// server/domains/*.js: a simple flat hint, an optional-marker mix, a nested
// object value (must be skipped — a flat form would misrepresent it), an
// array-of-objects value (same), a `{ a } | { b }` union (same), a comment
// with no `input:` clause at all, and a comment that ISN'T immediately
// adjacent to the register(...) call it precedes (must not attach).
//
// Also proves scripts/extract-macro-input-hints.mjs --check is a real drift
// gate (CI gate negative-case style, mirrors ci-gate-negative-cases.test.js):
// a deliberately staled server/lib/macro-input-hints.js is caught and
// reported non-zero, then the real regenerate call restores it so this test
// never leaves the repo's generated file mutated.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  findBlockComments,
  findRegisterCalls,
  parseInputHint,
  extractHintsFromSource,
} from "../../scripts/extract-macro-input-hints.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERATED = path.join(ROOT, "server", "lib", "macro-input-hints.js");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("parseInputHint — flat shapes", () => {
  it("parses a simple all-required field list", () => {
    const fields = parseInputHint("/** foo.bar. input: { schemeId, worldId } */");
    assert.deepEqual(fields, [
      { name: "schemeId", optional: false },
      { name: "worldId", optional: false },
    ]);
  });

  it("parses a mix of required and optional (trailing ?) fields", () => {
    const fields = parseInputHint("/** input: { userId?, includeBody?, limit? } */");
    assert.deepEqual(fields, [
      { name: "userId", optional: true },
      { name: "includeBody", optional: true },
      { name: "limit", optional: true },
    ]);
  });

  it("ignores a trailing output-shape annotation after the input braces", () => {
    const fields = parseInputHint("/** input: { questId, userId? }  -> { ok, objectives } */");
    assert.deepEqual(fields, [
      { name: "questId", optional: false },
      { name: "userId", optional: true },
    ]);
  });

  it("returns null when there is no input: clause at all", () => {
    assert.equal(parseInputHint("/** schemes.move — force-advance a phase. */"), null);
  });
});

describe("parseInputHint — non-flat shapes are skipped, not misrepresented", () => {
  it("returns null for a field with a nested object value", () => {
    assert.equal(
      parseInputHint("/** input: { schemeId, worldId, location?: {x,y,z} } */"),
      null,
    );
  });

  it("returns null for a field with an array-of-objects value", () => {
    assert.equal(
      parseInputHint("/** input: { questId, objectives:[{type,target,requiredCount?}] } */"),
      null,
    );
  });

  it("returns null for a union of two shapes", () => {
    assert.equal(parseInputHint("/** input: { id } | { worldspec } */"), null);
  });
});

describe("extractHintsFromSource — end-to-end against literal register() call fixtures", () => {
  it("attaches a hint only to the register() call it immediately precedes", () => {
    const src = `
export default function registerFixtureMacros(register) {
  /**
   * fixture.simple — a plain flat hint.
   * input: { a, b? }
   */
  register("fixture", "simple", async (ctx, input = {}) => {
    return { ok: true };
  });

  register("fixture", "no_comment", async (ctx) => {
    return { ok: true };
  });

  /**
   * fixture.nested — has a nested shape, must not produce a flat hint.
   * input: { a, item: { x, y } }
   */
  register("fixture", "nested", async (ctx, input = {}) => {
    return { ok: true };
  });
}
`;
    const hints = extractHintsFromSource(src);
    assert.deepEqual(hints["fixture.simple"], [
      { name: "a", optional: false },
      { name: "b", optional: true },
    ]);
    assert.equal(hints["fixture.no_comment"], undefined);
    assert.equal(hints["fixture.nested"], undefined);
  });

  it("does not attach a comment to a call it does not directly precede (non-whitespace between)", () => {
    const src = `
  /**
   * fixture.stale_comment — documents THIS call in prose, but real code sits
   * between the comment and the actual register() call below, so it must
   * not be treated as documenting fixture.actual_target.
   * input: { shouldNotAttach }
   */
  const unrelated = computeSomethingFirst();
  register("fixture", "actual_target", async (ctx, input = {}) => {
    return { ok: true, unrelated };
  });
`;
    const hints = extractHintsFromSource(src);
    assert.equal(hints["fixture.actual_target"], undefined);
  });

  it("never matches registerLensAction(...) as if it were register(...)", () => {
    const src = `
  /**
   * input: { shouldNotBeExtracted }
   */
  registerLensAction("fixture", "lens_action_style", (ctx, artifact, params) => {
    return { ok: true };
  });
`;
    const calls = findRegisterCalls(src);
    assert.equal(calls.length, 0);
    const hints = extractHintsFromSource(src);
    assert.deepEqual(hints, {});
  });

  it("findBlockComments indexes every /** ... */ block with correct start/end", () => {
    const src = "before /** one */ middle /** two */ after";
    const comments = findBlockComments(src);
    assert.equal(comments.length, 2);
    assert.equal(comments[0].text, "/** one */");
    assert.equal(comments[1].text, "/** two */");
    assert.equal(src.slice(comments[0].start, comments[0].end), "/** one */");
  });
});

describe("CI gate — scripts/extract-macro-input-hints.mjs --check is a real drift gate", () => {
  it("known-bad: a deliberately staled generated file is caught and exits non-zero, then is restored", () => {
    const before = fs.readFileSync(GENERATED, "utf8");
    try {
      fs.writeFileSync(GENERATED, before.replace("MACRO_INPUT_HINTS = {", "MACRO_INPUT_HINTS = { \"deliberately.staled\": [],"));
      const r = run("node", ["scripts/extract-macro-input-hints.mjs", "--check"]);
      assert.equal(r.code, 1, `expected non-zero exit on staled input, got 0. stderr=${r.stderr}`);
      assert.match(r.stderr, /STALE vs freshly-extracted output/);
    } finally {
      fs.writeFileSync(GENERATED, before);
    }
  });

  it("control: the real committed file currently matches freshly-extracted output", () => {
    const r = run("node", ["scripts/extract-macro-input-hints.mjs", "--check"]);
    assert.equal(r.code, 0, `expected the committed server/lib/macro-input-hints.js to match; stderr=${r.stderr}`);
  });
});

// Belt-and-braces: even if an assertion above throws mid-test, never leave
// the generated file mutated on disk for a later test file to trip over.
after(() => {
  const r = spawnSync("git", ["diff", "--name-only", "--", "server/lib/macro-input-hints.js"], { cwd: ROOT, encoding: "utf8" });
  if (r.stdout && r.stdout.trim()) {
    spawnSync("git", ["checkout", "--", "server/lib/macro-input-hints.js"], { cwd: ROOT });
  }
});
