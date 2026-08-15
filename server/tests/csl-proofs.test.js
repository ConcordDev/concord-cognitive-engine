/**
 * csl-proofs — Sprint 37: full proof obligation taxonomy
 *
 * Pins the six obligations from docs/SPRINT-34-Z3-PROOF-OBLIGATIONS.md §5
 * (server/lib/csl-proof-obligations.js) both directly (SAT + a forced UNSAT
 * per obligation, no Z3/brain needed — everything here is deterministic:
 * model-checking or ground-truth arithmetic) and wired end-to-end through
 * ConcordSoSRuntime#executeTurn's proofArtifact.obligations.
 *
 * Run: node --test server/tests/csl-proofs.test.js
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerServerCleanExit } from "./lib/server-clean-exit.js";
import {
  checkDtuMintIntegrity,
  checkMacroLockSafety,
  checkCitationCascadeIntegrity,
  checkMemoryBudgetCompliance,
  checkSchemaMigrationSafety,
  checkIntentRoutingCorrectness,
  runProofObligations,
  PROOF_OBLIGATIONS,
} from "../lib/csl-proof-obligations.js";
import { ConcordSoSRuntime } from "../lib/csl-core.js";

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";

// executeTurn's step 7 dynamically imports ../server.js, which touches the
// real DB_PATH/STATE_PATH defaults if unset -- isolate to a temp dir, same
// as csl-core.test.js.
let _tmpDir = null;
if (!process.env.DB_PATH || !process.env.STATE_PATH) {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "csl-proofs-"));
  if (!process.env.DB_PATH) process.env.DB_PATH = path.join(_tmpDir, "concord.db");
  if (!process.env.STATE_PATH) process.env.STATE_PATH = path.join(_tmpDir, "concord-state.json");
}
after(() => {
  if (_tmpDir) {
    try { fs.rmSync(_tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
});

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

const ALL_KEYS = [
  "citationCascadeIntegrity",
  "dtuMintIntegrity",
  "intentRoutingCorrectness",
  "macroLockSafety",
  "memoryBudgetCompliance",
  "schemaMigrationSafety",
].sort();

describe("csl-proof-obligations — 1. DTU mint integrity", () => {
  it("SAT: computed hash equals the expected hash", async () => {
    const r = await checkDtuMintIntegrity({ content: { a: 1, b: "x" } });
    assert.equal(r.sat, true);
    assert.equal(r.model.actualHash, r.model.expectedHash);
  });
  it("UNSAT: a mismatched expected hash forces a violation", async () => {
    const r = await checkDtuMintIntegrity({ content: { a: 1 }, expectedHash: "not-the-real-hash" });
    assert.equal(r.sat, false);
    assert.notEqual(r.model.actualHash, r.model.expectedHash);
  });
  it("degrades honestly with no payload", async () => {
    const r = await checkDtuMintIntegrity({});
    assert.equal(r.sat, null);
    assert.equal(r.error, "not_applicable");
  });
});

describe("csl-proof-obligations — 2. macro lock safety", () => {
  it("SAT: the correct lock model never reaches a self-deadlock state", async () => {
    const r = await checkMacroLockSafety({});
    assert.equal(r.sat, true);
    assert.equal(r.model.checkModel.status, "no_violation_found");
  });
  it("UNSAT: forceViolation reproduces the self-deadlock counterexample", async () => {
    const r = await checkMacroLockSafety({ forceViolation: true });
    assert.equal(r.sat, false);
    assert.equal(r.model.checkModel.status, "violation");
    assert.equal(r.model.checkModel.invariant, "no_self_wait");
    assert.ok(Array.isArray(r.model.checkModel.trace));
  });
});

describe("csl-proof-obligations — 3. citation cascade integrity", () => {
  it("SAT: the real (capped) royalty model never exceeds 30% of sale amount", async () => {
    const r = await checkCitationCascadeIntegrity({});
    assert.equal(r.sat, true);
    assert.equal(r.model.checkModel.status, "no_violation_found");
  });
  it("UNSAT: forceViolation disables the cap and payout blows past 30%", async () => {
    const r = await checkCitationCascadeIntegrity({ forceViolation: true, saleAmount: 1000 });
    assert.equal(r.sat, false);
    assert.equal(r.model.checkModel.status, "violation");
  });
});

describe("csl-proof-obligations — 4. memory budget compliance", () => {
  it("SAT: a small turn stays within the default 8MB budget", async () => {
    const r = await checkMemoryBudgetCompliance({ macroResult: { ok: true, result: "small" }, context: [] });
    assert.equal(r.sat, true);
  });
  it("UNSAT: an oversized turn trips a tiny injected budget", async () => {
    const prior = process.env.CONCORD_CSL_TURN_BUDGET_BYTES;
    process.env.CONCORD_CSL_TURN_BUDGET_BYTES = "10";
    try {
      const r = await checkMemoryBudgetCompliance({ macroResult: { ok: true, result: "x".repeat(1000) }, context: [] });
      assert.equal(r.sat, false);
      assert.ok(r.model.workingSetBytes > 10);
    } finally {
      if (prior === undefined) delete process.env.CONCORD_CSL_TURN_BUDGET_BYTES;
      else process.env.CONCORD_CSL_TURN_BUDGET_BYTES = prior;
    }
  });
});

describe("csl-proof-obligations — 5. schema migration safety", () => {
  it("honestly abstains when no turn touched a migration (category error per the audit)", async () => {
    const r = await checkSchemaMigrationSafety({});
    assert.equal(r.sat, null);
    assert.equal(r.error, "not_applicable");
  });
  it("SAT: every before-column survives into the after set", async () => {
    const r = await checkSchemaMigrationSafety({ migrationColumnsBefore: ["a", "b"], migrationColumnsAfter: ["a", "b", "c"] });
    assert.equal(r.sat, true);
  });
  it("UNSAT: a before-column is dropped from after (data loss)", async () => {
    const r = await checkSchemaMigrationSafety({ migrationColumnsBefore: ["a", "b"], migrationColumnsAfter: ["a"] });
    assert.equal(r.sat, false);
    assert.deepEqual(r.model.missing, ["b"]);
  });
});

describe("csl-proof-obligations — 6. intent routing correctness", () => {
  it("SAT: a formal-intent turn correctly reaches CSL", async () => {
    const r = await checkIntentRoutingCorrectness({ turnText: "3 + 4" });
    assert.equal(r.sat, true);
    assert.equal(r.model.intent, "deterministic-engine");
  });
  it("UNSAT: a language-intent turn that reached CSL anyway violates the gate", async () => {
    const r = await checkIntentRoutingCorrectness({ turnText: "why is the sky blue?", reachedCsl: true });
    assert.equal(r.sat, false);
    assert.equal(r.model.intent, "language");
  });
});

describe("csl-proof-obligations — runProofObligations orchestrator", () => {
  it("runs all six, keyed, and never throws on an empty context", async () => {
    const out = await runProofObligations({});
    assert.deepEqual(Object.keys(out).sort(), ALL_KEYS);
    for (const key of ALL_KEYS) assert.ok("sat" in out[key], `${key} missing sat`);
  });
});

describe("csl-proof-obligations — wired into ConcordSoSRuntime#executeTurn", () => {
  it("a formal-intent turn carries all six obligations in proofArtifact", async () => {
    const mock = async (domain, name) => {
      if (domain === "dtu" && name === "create") return { ok: true, id: "dtu-proof-mock-1" };
      if (domain === "qa" && name === "compute") return { ok: true, result: { value: 7 } };
      return { ok: false, reason: "unknown_macro" };
    };
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: mock });
    try {
      const r = await runtime.executeTurn({
        userId: "qa-user",
        sessionId: "s-proofs",
        turnText: "3 + 4",
        domainHint: "qa",
        macroHint: "compute",
      });
      assert.equal(r.ok, true);
      assert.equal(r.dtuId, "dtu-proof-mock-1");
      const obligations = r.proofArtifact.obligations;
      assert.deepEqual(Object.keys(obligations).sort(), ALL_KEYS);
      assert.equal(obligations.intentRoutingCorrectness.sat, true);
      assert.equal(obligations.macroLockSafety.sat, true);
      // qa.compute isn't royalty-touching -> the obligation honestly abstains,
      // not a manufactured pass (§6's wire-up plan: "no proof obligation
      // fires" for non-royalty macros is correct behavior).
      assert.equal(obligations.citationCascadeIntegrity.error, "not_applicable");
      assert.equal(obligations.dtuMintIntegrity.sat, true);
    } finally {
      runtime.stopLockSweep();
    }
  });

  it("a language-intent turn is rejected before macro invoke but still records obligation 6", async () => {
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: async () => ({ ok: true }) });
    try {
      const r = await runtime.executeTurn({ sessionId: "s-proofs-2", turnText: "why is the sky blue?" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "not_formal_intent");
      assert.equal(r.proofArtifact.obligations.intentRoutingCorrectness.sat, false);
    } finally {
      runtime.stopLockSweep();
    }
  });

  it("a royalty-touching macro fires the citation cascade obligation", async () => {
    const mock = async (domain, name) => {
      if (domain === "dtu" && name === "create") return { ok: true, id: "dtu-proof-mock-2" };
      if (domain === "marketplace" && name === "purchaseWithRoyalties") return { ok: true, result: { paid: 100 } };
      return { ok: false, reason: "unknown_macro" };
    };
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: mock });
    try {
      const r = await runtime.executeTurn({
        userId: "qa-user",
        sessionId: "s-proofs-3",
        turnText: "3 + 4",
        domainHint: "marketplace",
        macroHint: "purchaseWithRoyalties",
      });
      assert.equal(r.ok, true);
      const cascade = r.proofArtifact.obligations.citationCascadeIntegrity;
      assert.notEqual(cascade.error, "not_applicable");
      assert.equal(cascade.sat, true);
    } finally {
      runtime.stopLockSweep();
    }
  });
});

describe("csl-proof-obligations — Sprint 38: dtuMintIntegrity blocking rollout", () => {
  // dtuMintIntegrity is real and genuinely testable (SAT/UNSAT) in isolation
  // (see the "1. DTU mint integrity" describe block above), but as CURRENTLY
  // wired from executeTurn (no independent expected-hash provenance exists
  // yet at that call site) it self-consistently hashes the payload against
  // itself and can never organically observe sat:false in production. These
  // tests pin the BLOCKING MECHANISM itself (the gate really stops the mint,
  // the flag really gates it, sat:null never blocks) by substituting a
  // forced-violation stub for the one call these tests need it -- a standard
  // way to test a gate's wiring independent of whether a real trigger path
  // exists yet for the obligation it gates.
  const mockOk = async (domain, name) => {
    if (domain === "dtu" && name === "create") return { ok: true, id: "dtu-proof-mock-blocking" };
    if (domain === "qa" && name === "compute") return { ok: true, result: { value: 1 } };
    return { ok: false, reason: "unknown_macro" };
  };

  it("stays observational (mints anyway) when CONCORD_CSL_PROOFS_BLOCKING is unset, even on a forced violation", async () => {
    const original = PROOF_OBLIGATIONS.dtuMintIntegrity;
    PROOF_OBLIGATIONS.dtuMintIntegrity = async () => ({ sat: false, model: { forced: true } });
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: mockOk });
    try {
      const r = await runtime.executeTurn({
        userId: "qa-user", sessionId: "s-proofs-block-1", turnText: "3 + 4",
        domainHint: "qa", macroHint: "compute",
      });
      assert.equal(r.ok, true);
      assert.equal(r.dtuId, "dtu-proof-mock-blocking");
      assert.equal(r.proofArtifact.obligations.dtuMintIntegrity.sat, false);
    } finally {
      PROOF_OBLIGATIONS.dtuMintIntegrity = original;
      runtime.stopLockSweep();
    }
  });

  it("blocks the mint when CONCORD_CSL_PROOFS_BLOCKING=true and dtuMintIntegrity.sat is false", async () => {
    const original = PROOF_OBLIGATIONS.dtuMintIntegrity;
    PROOF_OBLIGATIONS.dtuMintIntegrity = async () => ({ sat: false, model: { forced: true } });
    let mintCalled = false;
    const mock = async (domain, name) => {
      if (domain === "dtu" && name === "create") {
        mintCalled = true;
        return { ok: true, id: "should-not-mint" };
      }
      if (domain === "qa" && name === "compute") return { ok: true, result: { value: 1 } };
      return { ok: false, reason: "unknown_macro" };
    };
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: mock });
    const prior = process.env.CONCORD_CSL_PROOFS_BLOCKING;
    process.env.CONCORD_CSL_PROOFS_BLOCKING = "true";
    try {
      const r = await runtime.executeTurn({
        userId: "qa-user", sessionId: "s-proofs-block-2", turnText: "3 + 4",
        domainHint: "qa", macroHint: "compute",
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "proof_obligation_failed");
      assert.equal(r.dtuId, undefined);
      assert.equal(mintCalled, false, "dtu.create must not run once the mint-integrity gate blocks");
      assert.equal(r.proofArtifact.obligations.dtuMintIntegrity.sat, false);
    } finally {
      if (prior === undefined) delete process.env.CONCORD_CSL_PROOFS_BLOCKING;
      else process.env.CONCORD_CSL_PROOFS_BLOCKING = prior;
      PROOF_OBLIGATIONS.dtuMintIntegrity = original;
      runtime.stopLockSweep();
    }
  });

  it("sat:null (inconclusive) never blocks, even with the flag on", async () => {
    const original = PROOF_OBLIGATIONS.dtuMintIntegrity;
    PROOF_OBLIGATIONS.dtuMintIntegrity = async () => ({ sat: null, error: "proof_skipped" });
    let mintCalled = false;
    const mock = async (domain, name) => {
      if (domain === "dtu" && name === "create") {
        mintCalled = true;
        return { ok: true, id: "dtu-proof-mock-blocking-3" };
      }
      if (domain === "qa" && name === "compute") return { ok: true, result: { value: 1 } };
      return { ok: false, reason: "unknown_macro" };
    };
    const runtime = new ConcordSoSRuntime({ db: null, lensActions: [], runMacro: mock });
    const prior = process.env.CONCORD_CSL_PROOFS_BLOCKING;
    process.env.CONCORD_CSL_PROOFS_BLOCKING = "true";
    try {
      const r = await runtime.executeTurn({
        userId: "qa-user", sessionId: "s-proofs-block-3", turnText: "3 + 4",
        domainHint: "qa", macroHint: "compute",
      });
      assert.equal(r.ok, true);
      assert.equal(mintCalled, true);
      assert.equal(r.dtuId, "dtu-proof-mock-blocking-3");
    } finally {
      if (prior === undefined) delete process.env.CONCORD_CSL_PROOFS_BLOCKING;
      else process.env.CONCORD_CSL_PROOFS_BLOCKING = prior;
      PROOF_OBLIGATIONS.dtuMintIntegrity = original;
      runtime.stopLockSweep();
    }
  });
});
