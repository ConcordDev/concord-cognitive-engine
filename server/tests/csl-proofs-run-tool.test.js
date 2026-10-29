// CSL-PROOFS-RUN TOOL regression test (FIX-ALL Q33, audit row B#21).
//
// Pins the fix for: the csl_proofs_run MCP tool (lib/mcp-tools.js
// cslProofsRun) returned status "not_loaded" for EVERY obligation —
// a placeholder claiming csl-proof-obligations.js wasn't loaded in
// the process. The module exists and is fully implemented (its own
// suite: tests/csl-proofs.test.js); the tool now runs the real
// obligations with the payload as the turn context and maps their
// verdicts honestly:
//   sat true  -> "proven"   (verifier: z3 | deterministic)
//   sat false -> "refuted"
//   sat null  -> the obligation's own status (not_applicable /
//                proof_skipped) — never a fabricated verdict
// Unknown names get a per-item "unknown_obligation" naming the valid
// set. Everything below is deterministic — no Z3 binary required
// (proveOrFallback falls back to the deterministic ground truth).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cslProofsRun } from "../lib/mcp-tools.js";

const run = (obligations, payload) => cslProofsRun(null, { obligations, payload: JSON.stringify(payload ?? {}) });

describe("cslProofsRun tool wiring (Q33)", () => {
  it("macroLockSafety proves on the sound model and refutes the forced violation", async () => {
    const ok = await run(["macroLockSafety"], {});
    assert.equal(ok.ok, true);
    assert.equal(ok.results[0].status, "proven");
    assert.equal(ok.results[0].sat, true);
    assert.equal(ok.results[0].verifier, "deterministic");

    const bad = await run(["macroLockSafety"], { forceViolation: true });
    assert.equal(bad.results[0].status, "refuted");
    assert.equal(bad.results[0].sat, false);
  });

  it("citationCascadeIntegrity proves by default and refutes when the cap is forced off", async () => {
    const ok = await run(["citationCascadeIntegrity"], { saleAmount: 1000 });
    assert.equal(ok.results[0].status, "proven");
    const bad = await run(["citationCascadeIntegrity"], { saleAmount: 1000, forceViolation: true });
    assert.equal(bad.results[0].status, "refuted");
  });

  it("schemaMigrationSafety: not_applicable with no migration in the payload, proven/refuted on column sets", async () => {
    const na = await run(["schemaMigrationSafety"], {});
    assert.equal(na.results[0].status, "not_applicable");
    assert.equal(na.results[0].sat, null);

    const kept = await run(["schemaMigrationSafety"], { migrationColumnsBefore: ["a", "b"], migrationColumnsAfter: ["a", "b", "c"] });
    assert.equal(kept.results[0].status, "proven");

    const lost = await run(["schemaMigrationSafety"], { migrationColumnsBefore: ["a", "b"], migrationColumnsAfter: ["a"] });
    assert.equal(lost.results[0].status, "refuted");
  });

  it("dtuMintIntegrity verifies the payload hash against expectedHash when supplied", async () => {
    const selfConsistent = await run(["dtuMintIntegrity"], { content: "hello concord" });
    assert.equal(selfConsistent.results[0].status, "proven");

    const wrong = await run(["dtuMintIntegrity"], { content: "hello concord", expectedHash: "deadbeef" });
    assert.equal(wrong.results[0].status, "refuted");
  });

  it("intentRoutingCorrectness proves when the turn never reached CSL", async () => {
    const r = await run(["intentRoutingCorrectness"], { turnText: "hello, how are you?", reachedCsl: false });
    assert.equal(r.results[0].status, "proven");
  });

  it("resolves snake_case names and reports unknown obligations honestly", async () => {
    const snake = await run(["macro_lock_safety"], {});
    assert.equal(snake.results[0].obligation, "macroLockSafety");
    assert.equal(snake.results[0].status, "proven");

    const unknown = await run(["nonsense_obligation"], {});
    assert.equal(unknown.results[0].status, "unknown_obligation");
    assert.match(unknown.results[0].note, /dtuMintIntegrity/);
  });

  it("never returns the old not_loaded placeholder for any obligation", async () => {
    const all = await run(
      ["dtuMintIntegrity", "macroLockSafety", "citationCascadeIntegrity", "memoryBudgetCompliance", "schemaMigrationSafety", "intentRoutingCorrectness"],
      { content: "x" },
    );
    assert.equal(all.results.length, 6);
    for (const r of all.results) assert.notEqual(r.status, "not_loaded", JSON.stringify(r));
  });

  it("validates its inputs", async () => {
    assert.equal((await cslProofsRun(null, { obligations: [] })).ok, false);
    assert.equal((await cslProofsRun(null, { obligations: ["macroLockSafety"], payload: "{not json" })).ok, false);
    assert.equal((await run(["macroLockSafety"], {})).payload_size > 0, true);
  });
});
