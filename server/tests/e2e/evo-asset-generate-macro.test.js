/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 4 gap-fix): "evo-asset.generate —
 * the missing on-demand trigger for Program C's generative pipeline."
 *
 * server/tests/e2e/design-simulate-fea-loop.test.js proved
 * `generateValidatedAsset` composes correctly end-to-end (parametric mesh ->
 * real FEA structural gate -> mass grounding -> pack .glb -> register -> gate
 * -> promote -> resolve) when called DIRECTLY, but its header documents a
 * REAL GAP: the only production caller was the fixed one-item
 * `GENERATION_TARGETS` heartbeat list (server/lib/evo-asset/scheduler.js) —
 * there was no macro or HTTP route letting a player or ConKay trigger a
 * CUSTOM on-demand design.
 *
 * The fix is `server/domains/evo-asset.js`'s new `evo-asset.generate` macro,
 * registered into the real macro dispatcher (server.js). This test proves
 * the gap is closed the honest way: through the REAL `runMacro` dispatch
 * (server/tests/depth/_harness.js's `macroRuntime`, the established pattern
 * for behavioral macro tests — same as the other two CL3 gap-fix E2E files),
 * never a direct call to the library function that bypasses the macro layer.
 *
 * `EVO_ASSET_GEN_DIR` is set BELOW, before `macroRuntime`'s first (lazy,
 * dynamic) import of server.js — generate-asset.js's `GENERATED_ASSET_DIR`
 * is a module-eval-time const, so this must land before that module is ever
 * loaded. This file deliberately does NOT statically import
 * lib/asset-gen/generate-asset.js (unlike design-simulate-fea-loop.test.js,
 * which always passes an explicit `outDir` and so never depends on the
 * default) — doing so would fix GENERATED_ASSET_DIR to the process default
 * before this env var could take effect.
 *
 * Run: node --test tests/e2e/evo-asset-generate-macro.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir;
let runMacro, STATE, ctx;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-e2e-evoasset-gen-"));
  process.env.EVO_ASSET_GEN_DIR = tmpDir;

  const { macroRuntime } = await import("../depth/_harness.js");
  ({ runMacro, STATE, ctx } = await macroRuntime("evo-asset-generate-macro"));
});

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe("evo-asset.generate — GAP CLOSED: on-demand custom generation through the real macro dispatch", () => {
  it("a caller-supplied, known-robust param set generates a real .glb, registers, gates, and resolves it — through runMacro, not a direct library call", async () => {
    // bladeBaseThickness 0.012 is the "known-robust" value
    // design-simulate-fea-loop.test.js's Stage 2 already proved passes the
    // FEA gate — reused here (not re-derived) so this test's expected
    // outcome (structural convergence) comes from an already-verified fact,
    // not a fresh guess.
    const r = await runMacro("evo-asset", "generate", {
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
    }, ctx);

    assert.equal(r.ok, true, `evo-asset.generate must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.archetype, "sword");
    assert.equal(r.created, true, "this exact param set must not already be registered");
    assert.ok(r.assetId, "a real registered asset id");
    assert.ok(r.versionId, "a real registered version id");

    // The SAME structural gate the heartbeat respects — a real, passing
    // computed utilization ratio, not a placeholder.
    assert.equal(r.feaResult.ok, true);
    assert.ok(Number.isFinite(r.feaResult.maxUtilization) && r.feaResult.maxUtilization < 1,
      `expected a real passing utilization ratio, got ${r.feaResult.maxUtilization}`);
    assert.ok(Number.isFinite(r.massProps.mass_kg) && r.massProps.mass_kg > 0.05 && r.massProps.mass_kg < 10,
      `mass_kg ${r.massProps.mass_kg} outside sane hand-weapon range`);

    // A real .glb landed on disk under the macro's own generation dir — not
    // a log line claiming success.
    const registeredRow = STATE.db.prepare(`SELECT local_path FROM evo_assets WHERE id = ?`).get(r.assetId);
    assert.ok(registeredRow, "the asset must be a real row in evo_assets");
    assert.ok(fs.existsSync(registeredRow.local_path), "the registered local_path must be a real file on disk");
    assert.ok(registeredRow.local_path.startsWith(tmpDir), "must write under the macro's own generation dir, never a caller-supplied outDir");

    // The version row is really gated (Atlas bridge ran through the same
    // createAtlasDtu/runAutoPromoteGate/promoteAtlasDtu wiring the
    // heartbeat uses) — verdict is one of the bridge's real outcomes, and
    // the response is honest about whichever one actually happened (no
    // fabricated "verified" when the atlas modules were unavailable).
    assert.ok(["verified", "disputed", "quarantined", "pending"].includes(r.gateVerdict));
    const versionRow = STATE.db.prepare(`SELECT gate_verdict, promoted FROM evo_asset_versions WHERE id = ?`).get(r.versionId);
    assert.ok(versionRow, "the version must be a real row in evo_asset_versions");
    assert.equal(versionRow.gate_verdict, r.gateVerdict, "the persisted gate_verdict must match what the macro reported — no drift between what's returned and what's stored");
    assert.equal(!!versionRow.promoted, r.promoted);

    // Resolvable via the SAME primitive /api/evo-asset/resolve uses — the
    // "visible proof" this whole pipeline exists to produce.
    if (r.promoted) {
      assert.ok(r.resolved, "a promoted candidate must resolve to a real canonical asset");
      assert.equal(r.resolved.canonicalPath, registeredRow.local_path);
    }
  });

  it("calling the SAME params again is idempotent on the target — no duplicate registration, no duplicate file", async () => {
    const first = await runMacro("evo-asset", "generate", {
      archetype: "sword",
      params: { bladeBaseThickness: 0.014 },
    }, ctx);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);

    const second = await runMacro("evo-asset", "generate", {
      archetype: "sword",
      params: { bladeBaseThickness: 0.014 },
    }, ctx);
    assert.equal(second.ok, true);
    // Same target (archetype + seed params) -> same sourceId -> registerAsset
    // recognizes the existing row rather than minting a duplicate.
    assert.equal(second.sourceId, first.sourceId);
    assert.equal(second.assetId, first.assetId);
    assert.equal(second.created, false, "re-generating an already-registered target must not create a duplicate asset row");
  });

  it("HONESTY GATE (never a shortcut): a caller-supplied impossible spec never reaches the registry — the SAME structural gate the heartbeat respects", async () => {
    const before = STATE.db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;

    const r = await runMacro("evo-asset", "generate", {
      archetype: "sword",
      params: { bladeBaseThickness: 0.006 }, // marginal per design-simulate-fea-loop.test.js's Stage 2
      tipLoadN: 100000,                       // unreasonable load — forces non-convergence
      maxIters: 2,
    }, ctx);

    assert.equal(r.ok, false);
    assert.equal(r.reason, "fea_did_not_converge");
    assert.equal(r.assetId, undefined, "no asset id — nothing was registered");

    const after = STATE.db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;
    assert.equal(after, before, "an unconverged design must never add a row to evo_assets — no fabricated 'visible proof'");
  });

  it("SECURITY: a macro caller cannot redirect the write path via input.outDir — the generation dir is never caller-controlled", async () => {
    const maliciousOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-e2e-evoasset-malicious-"));
    try {
      const r = await runMacro("evo-asset", "generate", {
        archetype: "sword",
        params: { bladeBaseThickness: 0.011 },
        outDir: maliciousOutDir, // must be silently ignored — see domains/evo-asset.js header
      }, ctx);
      assert.equal(r.ok, true);
      const row = STATE.db.prepare(`SELECT local_path FROM evo_assets WHERE id = ?`).get(r.assetId);
      assert.ok(row.local_path.startsWith(tmpDir), "must land under the macro's own EVO_ASSET_GEN_DIR");
      assert.ok(!row.local_path.startsWith(maliciousOutDir), "must NEVER honor a caller-supplied outDir");
      assert.equal(fs.readdirSync(maliciousOutDir).length, 0, "nothing was ever written into the caller-supplied path");
    } finally {
      try { fs.rmSync(maliciousOutDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    }
  });

  it("an unknown archetype fails honestly instead of silently generating a sword", async () => {
    const r = await runMacro("evo-asset", "generate", {
      archetype: "warhammer-of-the-future",
      params: {},
    }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_archetype");
  });
});
