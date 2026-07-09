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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const graderPath = resolve(here, "../../scripts/grade-ux-polish.mjs");
const repoRoot = resolve(here, "../..");

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

// ─────────────────────────────────────────────────────────────────────────────
// --honest mode: generic-scaffold demotion (FRONTEND_REBUILD_PROGRAM Phase 0.1).
//
// The default grader saturates at "polished" for all 260 lenses because the
// codemod that generated the scaffold inserted the structural pillars it
// checks. --honest adds an OPT-IN pass that caps a lens still shaped as the
// bare generated template (generic trio + <UniversalActions>/<LensFeaturePanel>
// body on a thin page with no substantial bespoke component) at 'functional'.
//
// These tests run the REAL grader in both modes and assert the JSON output.
// They are BIDIRECTIONAL and pin the three hard invariants:
//   (a) default mode is UNCHANGED — still every-lens-polished, 0 capped;
//   (b) --honest genuinely demotes a known scaffold (schema);
//   (c) --honest does NOT demote a verified-bespoke lens even though it also
//       mounts the trio footer (agents/wallet/all/tools) — no false positives.
// The grader is a run-on-import script, so we invoke it as a subprocess and
// read the audit artifacts it writes (transient; git-checkout-reverted in CI).
describe("ux-polish grader — --honest generic-scaffold demotion (bidirectional)", () => {
  let dflt, honest;
  before(() => {
    // Default run → audit/ux-polish.json ; honest run → audit/ux-polish-honest.json.
    execFileSync(process.execPath, [graderPath], { cwd: repoRoot, stdio: "ignore" });
    execFileSync(process.execPath, [graderPath, "--honest"], { cwd: repoRoot, stdio: "ignore" });
    dflt = JSON.parse(readFileSync(resolve(repoRoot, "audit/ux-polish.json"), "utf8"));
    honest = JSON.parse(readFileSync(resolve(repoRoot, "audit/ux-polish-honest.json"), "utf8"));
  });

  const byLens = (report, lens) => report.lenses.find((r) => r.lens === lens);

  it("(a) default mode is UNCHANGED — every lens polished, nothing capped", () => {
    assert.equal(dflt.mode, "default");
    assert.equal(dflt.totals.raw, 0);
    assert.equal(dflt.totals.functional, 0);
    assert.equal(dflt.totals.polished, dflt.lenses.length, "default: all lenses stay polished");
    assert.equal(dflt.scaffoldsCapped, 0, "default mode caps nothing — the flag is opt-in");
    // The demotion must be strictly additive: no lens is demoted in default mode.
    for (const r of dflt.lenses) assert.equal(r.honestCapped, false);
  });

  it("(b) --honest demotes generic scaffolds (a real, non-trivial drop)", () => {
    assert.equal(honest.mode, "honest");
    assert.ok(honest.scaffoldsCapped > 0, "honest mode caps at least one scaffold");
    assert.ok(
      honest.totals.polished < dflt.totals.polished,
      `honest polished (${honest.totals.polished}) must be < default (${dflt.totals.polished})`
    );
    // Every demotion is accounted for by the scaffold cap (nothing else moved).
    assert.equal(
      honest.totals.polished + honest.scaffoldsCapped,
      dflt.totals.polished,
      "the only tier change under --honest is polished→functional via the scaffold cap"
    );
    assert.equal(honest.totals.functional, honest.scaffoldsCapped);
  });

  it("(b) a known scaffold (schema) is capped under --honest, polished by default", () => {
    // Fixture lens choice: NOT a magic constant — pick any lens still on the
    // generic scaffold per the Frontend Rebuild Program's live backlog
    // (docs/FRONTEND_REBUILD_PROGRAM.md). `alliance` filled this role until
    // 2026-07-09's Wave 2 rebuild (commit 26ec0de2) graduated it to a real,
    // bespoke lens — this test failed then for the correct reason (the grader
    // was right, the fixture was stale), and was repointed at `schema`,
    // confirmed still-scaffolded as of this edit. If this test fails again
    // because ITS fixture lens also graduated, that's the same good failure —
    // repoint to another lens still in the backlog, don't weaken the assertion.
    const d = byLens(dflt, "schema");
    const h = byLens(honest, "schema");
    assert.ok(d && h, "schema lens present in both reports");
    assert.equal(d.tier, "polished", "schema scores polished in the blind default grader");
    assert.equal(h.isGenericScaffold, true, "schema is detected as the generated template shell");
    assert.equal(h.honestCapped, true, "schema is demoted under --honest");
    assert.equal(h.tier, "functional");
  });

  it("(c) verified-bespoke lenses are NOT capped, even though they mount the trio", () => {
    // agents (1200-line bespoke page), wallet (1764-line page + WalletParityHub),
    // all/tools (custom bodies that dropped the generic wrappers). All import the
    // trio footer but are genuinely designed — they must survive --honest.
    for (const lens of ["agents", "wallet", "all", "tools"]) {
      const h = byLens(honest, lens);
      assert.ok(h, `${lens} present in honest report`);
      assert.equal(h.isGenericScaffold, false, `${lens} must NOT be flagged as a generic scaffold`);
      assert.equal(h.honestCapped, false, `${lens} must NOT be demoted under --honest`);
      assert.equal(h.tier, "polished", `${lens} stays polished under --honest`);
    }
  });

  it("(c) no lens is ever promoted or demoted-below-functional by --honest", () => {
    // Honest tier is either identical to default or exactly one step down
    // (polished→functional). Nothing is upgraded, and nothing falls to 'raw'.
    const rank = { raw: 0, functional: 1, polished: 2 };
    for (const d of dflt.lenses) {
      const h = byLens(honest, d.lens);
      assert.ok(h, `${d.lens} present in both`);
      assert.ok(rank[h.tier] <= rank[d.tier], `${d.lens} must not be promoted under --honest`);
      if (h.tier !== d.tier) {
        assert.equal(d.tier, "polished");
        assert.equal(h.tier, "functional");
        assert.equal(h.honestCapped, true);
      }
    }
  });
});
