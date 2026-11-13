// FIX-world-observatory-009 — deleting a Quick Capture's DTU removes its
// lens artifact.
//
// A capture in a lens creates TWO records: the lens artifact (the lens's
// own store; what Export JSON lists) and a lens_exhaust DTU (the vault
// record). Deleting the DTU used to leave the artifact behind — still
// exporting, with no UI anywhere to remove it. dtu.delete now cascades
// from the artifact's CREATE exhaust only, while the artifact is still
// its owner's unpublished record.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/dtu-delete-lens-cascade.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { STATE, runMacro, makeInternalCtx } = __TEST__;
registerServerCleanExit(() => __TEST__);

const ctx = makeInternalCtx("cascade-probe");
const DOMAIN = "world-observatory";

async function makeCapture(title) {
  const created = await runMacro("lens", "create", {
    domain: DOMAIN,
    type: "capture",
    title,
    data: { content: `body of ${title}`, source: "user.capture", tags: [DOMAIN], capturedAt: new Date().toISOString() },
  }, ctx);
  assert.equal(created?.ok, true, `capture create failed: ${JSON.stringify(created)}`);
  const artifactId = created.artifact.id;
  const exhaust = [...STATE.dtus.values()].find(
    (d) => d.machine?.kind === "lens_exhaust" && d.machine?.artifactId === artifactId && d.machine?.action === "create",
  );
  assert.ok(exhaust, "create exhaust DTU exists");
  return { artifactId, exhaustId: exhaust.id };
}

describe("dtu.delete cascades to the lens artifact (FIX-world-observatory-009)", () => {
  before(() => {
    assert.ok(STATE?.dtus && STATE?.lensArtifacts, "stores available");
  });

  it("deleting the create exhaust removes the artifact from the store, the list and the export", async () => {
    const { artifactId, exhaustId } = await makeCapture("qa-cascade-001");
    const del = await runMacro("dtu", "delete", { id: exhaustId }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), false, "artifact removed from the store");
    const list = await runMacro("lens", "list", { domain: DOMAIN }, ctx);
    assert.equal((list?.artifacts || []).some((a) => a.id === artifactId), false, "artifact gone from the lens list");
    const got = await runMacro("lens", "get", { id: artifactId, domain: DOMAIN }, ctx);
    assert.equal(got?.ok, false, "lens.get no longer finds it");
  });

  it("deleting a later lifecycle exhaust (update) leaves the artifact in place", async () => {
    const { artifactId } = await makeCapture("qa-cascade-002");
    const upd = await runMacro("lens", "update", { id: artifactId, title: "qa-cascade-002 renamed" }, ctx);
    assert.equal(upd?.ok, true, `update failed: ${JSON.stringify(upd)}`);
    const updateExhaust = [...STATE.dtus.values()].find(
      (d) => d.machine?.kind === "lens_exhaust" && d.machine?.artifactId === artifactId && d.machine?.action === "update",
    );
    assert.ok(updateExhaust, "update exhaust exists");
    const del = await runMacro("dtu", "delete", { id: updateExhaust.id }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), true, "artifact survives an update-exhaust delete");
  });

  it("a published artifact keeps its life: create-exhaust delete leaves it", async () => {
    const { artifactId, exhaustId } = await makeCapture("qa-cascade-003");
    const art = STATE.lensArtifacts.get(artifactId);
    art.meta = { ...(art.meta || {}), visibility: "published" };
    const del = await runMacro("dtu", "delete", { id: exhaustId }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), true, "published artifact not cascaded");
  });

  it("deleting an ordinary DTU touches no artifact", async () => {
    const { artifactId } = await makeCapture("qa-cascade-004");
    const plain = await runMacro("dtu", "create", { title: "plain note", content: "hello", tags: [] }, ctx);
    assert.equal(plain?.ok, true, `plain create failed: ${JSON.stringify(plain)}`);
    const plainId = plain.dtu?.id || plain.id;
    const del = await runMacro("dtu", "delete", { id: plainId }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), true, "unrelated artifact untouched");
  });
});
