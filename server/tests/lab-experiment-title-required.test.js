// INC-SWEEP lab F2 — POST lens.create for lab rejects blank title (no
// "New experiment"); a titled experiment survives LensArtifactStore rehydrate.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import Database from "better-sqlite3";

describe("lab F2 experiment title required", () => {
  let runMacro, STATE, makeInternalCtx;

  before(async () => {
    const t = await load();
    ({ runMacro, STATE, makeInternalCtx } = t);
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    if (!ctx.macro) ctx.macro = { run: (d, n, i) => runMacro(d, n, i, ctx) };
    return ctx;
  }

  it("refuses blank / missing title (no New experiment)", async () => {
    const ctx = ctxFor("u-lab-f2-" + Date.now().toString(36));
    for (const input of [
      { domain: "lab", type: "experiment" },
      { domain: "lab", type: "experiment", title: "", data: {} },
      { domain: "lab", type: "experiment", title: "   ", data: {} },
    ]) {
      const r = await runMacro("lens", "create", input, ctx);
      assert.equal(r.ok, false, JSON.stringify(input));
      assert.match(r.error, /title required/i);
      assert.equal(shapeLensRunHttp(r).status, 422);
      assert.ok(!String(r.artifact?.title || "").includes("New experiment"));
    }
  });

  it("creates a titled experiment that survives store rehydrate", async () => {
    const userId = "u-lab-f2p-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const r = await runMacro("lens", "create", {
      domain: "lab",
      type: "experiment",
      title: "experiment lab-f2 documented",
      data: { standards: [{ concentration: 0, response: 0 }] },
    }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.artifact.title, "experiment lab-f2 documented");
    assert.equal(r.artifact.data.standardCount, 1);

    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(r.artifact.id, structuredClone(r.artifact));
    const second = new LensArtifactStore(db);
    assert.equal(second.rehydrateFromSQLite().loaded, 1);
    const back = second.get(r.artifact.id);
    assert.equal(back.title, "experiment lab-f2 documented");
    assert.ok(STATE.lensArtifacts.has(r.artifact.id));
  });
});
