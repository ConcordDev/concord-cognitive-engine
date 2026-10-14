// INC-SWEEP lab F3 — Lab Analysis refusals are top-level ok:false (not outer
// ok:true). sampleTracker with no samples refuses. Real samples still compute.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("lab F3 analysis envelope + sampleTracker", () => {
  let runMacro, STATE, makeInternalCtx, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    ({ runMacro, STATE, makeInternalCtx } = t);
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    return ctx;
  }

  function putArtifact(userId, data) {
    const id = "lart_lab_f3_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const art = {
      id,
      domain: "lab",
      type: "experiment",
      title: "lab f3 probe",
      data: data || {},
      meta: { status: "draft", visibility: "private" },
      ownerId: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(id, art);
    return art;
  }

  it("empty artifact: calibrationCurve / sampleTracker / experimentDesign refuse at top level", async () => {
    const userId = "u-lab-f3-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const art = putArtifact(userId, { code: "x", organ: "abstraction_governor" });

    for (const action of ["calibrationCurve", "qcAnalysis", "sampleTracker", "experimentDesign"]) {
      const r = await runMacro("lens", "run", { id: art.id, action, params: {} }, ctx);
      assert.equal(r.ok, false, `${action}: ${JSON.stringify(r)}`);
      assert.ok(r.error, action);
      const shaped = shapeLensRunHttp(r);
      assert.equal(shaped.body.ok, false, action);
      assert.ok(shaped.status >= 400, `${action} status ${shaped.status}`);
    }
  });

  it("sampleTracker with real samples returns totals (not No samples message)", async () => {
    const userId = "u-lab-f3s-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const art = putArtifact(userId, {
      samples: [{
        id: "smp-1",
        type: "serum",
        receivedAt: "2026-10-14T12:00:00Z",
        steps: [
          { action: "received", timestamp: "2026-10-14T12:00:00Z", operator: "tech" },
          { action: "completed", timestamp: "2026-10-14T14:00:00Z", operator: "tech" },
        ],
      }],
    });
    const r = await runMacro("lens", "run", { id: art.id, action: "sampleTracker", params: {} }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.totalSamples, 1);
    assert.equal(r.result.completedCount, 1);
    assert.equal(r.result.turnaroundStats.avgMinutes, 120);

    const direct = LENS_ACTIONS.get("lab.sampleTracker")(ctx, { data: {} }, {});
    assert.equal(direct.ok, false);
    assert.match(direct.error, /samples required/i);
  });
});
