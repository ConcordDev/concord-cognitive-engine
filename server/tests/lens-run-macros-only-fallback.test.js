// Regression pinning: the Featured-Actions dispatch bug documented in
// audit/LENS_DESIGN_UPGRADE_PLAN.md (foundry #102, genesis #109, and the
// cross-cutting note). LensVerticalHero.tsx/AutoActionStrip.tsx discover
// actions from BOTH the artifact-scoped LENS_ACTIONS registry and the
// plain-macro MACROS registry (GET /api/lens-actions/:domain merges both),
// but always dispatch through the artifact-scoped `lens.run` macro
// (POST /api/lens/:domain/:id/run). A genuinely MACROS-only action (e.g.
// foundry.validate, registered via register() not registerLensAction) was
// never in LENS_ACTIONS, so `lens.run` fell straight to an AI-guess fallback
// (source: "utility-brain") instead of ever reaching the real, deterministic
// macro — the button silently never ran the real compute, just an LLM's
// guess at what it might do.
//
// Fix: `lens.run` now checks MACROS for the action before falling back to
// the AI guess, and dispatches through the real `runMacro()` path when found.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "./depth/_harness.js";

test("lens.run reaches a genuinely MACROS-only action instead of AI-guessing", async () => {
  const { runMacro, STATE } = await load();

  const OWNER = "lens-macro-fallback-owner";
  const id = `lens-macro-fallback-${randomUUID()}`;
  STATE.lensArtifacts.set(id, {
    id, domain: "foundry", type: "world",
    ownerId: OWNER, createdBy: OWNER,
    title: "test world",
    data: {}, // no worldspec — exercises the real macro's own honest-failure path
    meta: { visibility: "private" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });

  const r = await runMacro("lens", "run", { id, action: "validate", params: {} }, { actor: { userId: OWNER, role: "member" }, userId: OWNER });

  // The real foundry.validate macro's own honest-failure shape — proves the
  // REAL macro ran (not an AI guess, which would carry `source: "utility-brain"`
  // and freeform `output` text instead of this exact `reason` code).
  assert.equal(r.ok, true, "lens.run itself should succeed even though the inner macro reports ok:false");
  assert.equal(r.result?.ok, false);
  assert.equal(r.result?.reason, "missing_worldspec_or_id");
  assert.notEqual(r.result?.source, "utility-brain");
});
