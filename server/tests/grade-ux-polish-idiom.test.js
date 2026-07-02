// Bidirectional pinning test for the ux-polish grader's LOADING_RE / ERROR_UI_RE
// (user-authorized correctness broadening, 2026-07-02).
//
// The grader (scripts/grade-ux-polish.mjs) is a run-on-import script with no
// exports, so we extract the two regex literals from its source and assert them
// against fixtures. This pins the ACTUAL regexes in the file, and is
// BIDIRECTIONAL: it proves (a) the real load/error idioms the four false-negative
// lenses use are now detected, AND (b) code with NO loading/error UI still scores
// false — so the broadening recognizes real states without handing out free
// credit (no metric-gaming).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const graderPath = resolve(here, "../../scripts/grade-ux-polish.mjs");

// Extract a `const NAME = /.../flags;` regex literal from the grader source and
// rebuild it, so we test the exact pattern shipped in the file.
function extractRegex(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(/(?:\\\\.|[^/])+/[a-z]*)\\s*;`));
  assert.ok(m, `could not extract ${name} from the grader`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${m[1]};`)();
}

let LOADING_RE, ERROR_UI_RE;
before(() => {
  const src = readFileSync(graderPath, "utf8");
  LOADING_RE = extractRegex(src, "LOADING_RE");
  ERROR_UI_RE = extractRegex(src, "ERROR_UI_RE");
});

describe("ux-polish grader — LOADING_RE recognizes real load idioms (no free credit)", () => {
  it("detects the namespaced-enum idiom the four false-negative lenses use", () => {
    // Real code quoted from housing/quests/training-room/narrative-walk.
    assert.ok(LOADING_RE.test(`mineState === 'loading' ?`), "housing mineState");
    assert.ok(LOADING_RE.test(`frameStatus === "loading" ?`), "training-room frameStatus");
    assert.ok(LOADING_RE.test(`loadState === 'loading' &&`), "narrative-walk loadState");
    assert.ok(LOADING_RE.test(`state === 'loading' ?`), "quests state");
    assert.ok(LOADING_RE.test(`<ul aria-busy="true">`), "aria-busy loading");
  });

  it("still detects the original literal tokens", () => {
    assert.ok(LOADING_RE.test(`if (isLoading) return <Spinner/>`));
    assert.ok(LOADING_RE.test(`<Loader2 className="animate-spin"/>`));
    assert.ok(LOADING_RE.test(`status === 'loading'`));
  });

  it("does NOT match code with no loading UI (no free credit)", () => {
    assert.equal(LOADING_RE.test(`const x = state === 'ready' ? a : b;`), false);
    assert.equal(LOADING_RE.test(`<div className="p-4">{items.map(...)}</div>`), false);
    assert.equal(LOADING_RE.test(`// loading the data would be nice`), false, "prose 'loading' with no ?/& must not match");
  });
});

describe("ux-polish grader — ERROR_UI_RE recognizes real error idioms (no free credit)", () => {
  it("detects role=alert + enum idiom + namespaced setters the lenses use", () => {
    assert.ok(ERROR_UI_RE.test(`<div role="alert">Couldn't load</div>`), "role=alert");
    assert.ok(ERROR_UI_RE.test(`mineState === 'error' ?`), "enum error state");
    assert.ok(ERROR_UI_RE.test(`loadState === "error" &&`), "loadState error");
    assert.ok(ERROR_UI_RE.test(`setMineError(msg)`), "namespaced setter setMineError");
    assert.ok(ERROR_UI_RE.test(`setListError('boom')`), "namespaced setter setListError");
  });

  it("still detects the original error patterns", () => {
    assert.ok(ERROR_UI_RE.test(`setError('x')`));
    assert.ok(ERROR_UI_RE.test(`{error && <ErrorState/>}`));
    assert.ok(ERROR_UI_RE.test(`addToast({ type: 'error', message })`));
    assert.ok(ERROR_UI_RE.test(`if (isError) return null`));
  });

  it("does NOT match code with no error UI (no free credit)", () => {
    assert.equal(ERROR_UI_RE.test(`<div className="p-4">ok</div>`), false);
    assert.equal(ERROR_UI_RE.test(`const errorFree = compute();`), false, "'error' inside an identifier must not falsely match");
    assert.equal(ERROR_UI_RE.test(`state === 'ready'`), false);
  });
});
