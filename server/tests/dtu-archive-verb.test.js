// The canonical DTU archive/delete verb (CB-0554 ruling (1)) — deleting a
// record removes its whole family from either side.
//
// A lens artifact and its lens_exhaust DTUs are one record in two stores.
// Before this verb, lens.delete removed the artifact but left its
// create/update/delete exhausts in the owner's vault naming a dead piece
// (FIX-crafting-002), and dtu.delete's create-exhaust cascade removed the
// artifact but left the sibling lifecycle exhausts orphaned
// (FIX-ux-suite-015). Both paths now sweep the family via lib/dtu-family.js,
// and dtu.archive delegates to either path by id kind.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/dtu-archive-verb.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { STATE, runMacro, makeInternalCtx } = __TEST__;
registerServerCleanExit(() => __TEST__);

const ctx = makeInternalCtx("verb-probe");
const DOMAIN = "world-observatory";

function exhaustsOf(artifactId) {
  return [...STATE.dtus.values()].filter(
    (d) => d.machine?.kind === "lens_exhaust" && d.machine?.artifactId === artifactId,
  );
}

async function makeCaptureWithUpdate(title) {
  const created = await runMacro("lens", "create", {
    domain: DOMAIN,
    type: "capture",
    title,
    data: { content: `body of ${title}`, source: "user.capture", tags: [DOMAIN], capturedAt: new Date().toISOString() },
  }, ctx);
  assert.equal(created?.ok, true, `capture create failed: ${JSON.stringify(created)}`);
  const artifactId = created.artifact.id;
  const upd = await runMacro("lens", "update", { id: artifactId, title: `${title} renamed` }, ctx);
  assert.equal(upd?.ok, true, `capture update failed: ${JSON.stringify(upd)}`);
  const exhausts = exhaustsOf(artifactId);
  assert.ok(exhausts.length >= 2, "create + update exhausts exist");
  return { artifactId, exhausts };
}

describe("the DTU archive/delete verb removes the whole family", () => {
  before(() => {
    assert.ok(STATE?.dtus && STATE?.lensArtifacts, "stores available");
  });

  it("lens.delete sweeps the artifact's create/update/delete exhausts", async () => {
    const { artifactId, exhausts } = await makeCaptureWithUpdate("qa-verb-001");
    const del = await runMacro("lens", "delete", { id: artifactId }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), false, "artifact removed");
    assert.deepEqual(exhaustsOf(artifactId), [], "no exhaust names the dead artifact");
    for (const e of exhausts) assert.equal(STATE.dtus.has(e.id), false, `exhaust ${e.id} removed`);
  });

  it("deleting the create exhaust sweeps its sibling lifecycle exhausts", async () => {
    const { artifactId, exhausts } = await makeCaptureWithUpdate("qa-verb-002");
    const createExhaust = exhausts.find((d) => d.machine?.action === "create");
    assert.ok(createExhaust, "create exhaust exists");
    const del = await runMacro("dtu", "delete", { id: createExhaust.id }, ctx);
    assert.equal(del?.ok, true);
    assert.equal(STATE.lensArtifacts.has(artifactId), false, "artifact cascaded");
    assert.deepEqual(exhaustsOf(artifactId), [], "siblings swept, none orphaned");
  });

  it("dtu.archive by DTU id removes the family", async () => {
    const { artifactId, exhausts } = await makeCaptureWithUpdate("qa-verb-003");
    const createExhaust = exhausts.find((d) => d.machine?.action === "create");
    const out = await runMacro("dtu", "archive", { id: createExhaust.id }, ctx);
    assert.equal(out?.ok, true, `archive failed: ${JSON.stringify(out)}`);
    assert.equal(STATE.lensArtifacts.has(artifactId), false);
    assert.deepEqual(exhaustsOf(artifactId), []);
  });

  it("dtu.archive by artifact id removes the family", async () => {
    const { artifactId } = await makeCaptureWithUpdate("qa-verb-004");
    const out = await runMacro("dtu", "archive", { id: artifactId }, ctx);
    assert.equal(out?.ok, true, `archive failed: ${JSON.stringify(out)}`);
    assert.equal(STATE.lensArtifacts.has(artifactId), false);
    assert.deepEqual(exhaustsOf(artifactId), []);
  });

  it("dtu.archive on a plain DTU deletes just it", async () => {
    const plain = await runMacro("dtu", "create", { title: "verb plain note", content: "hello", tags: [] }, ctx);
    assert.equal(plain?.ok, true, `plain create failed: ${JSON.stringify(plain)}`);
    const plainId = plain.dtu?.id || plain.id;
    const out = await runMacro("dtu", "archive", { id: plainId }, ctx);
    assert.equal(out?.ok, true);
    assert.equal(STATE.dtus.has(plainId), false);
  });

  it("dtu.archive on an unknown id refuses", async () => {
    const out = await runMacro("dtu", "archive", { id: "dtu_does_not_exist" }, ctx);
    assert.equal(out?.ok, false);
    const missing = await runMacro("dtu", "archive", {}, ctx);
    assert.equal(missing?.ok, false);
  });

  it("a stranger cannot lens.delete another user's artifact or its family", async () => {
    const { artifactId, exhausts } = await makeCaptureWithUpdate("qa-verb-005");
    const stranger = {
      actor: { userId: "verb-stranger", role: "member" },
      log: () => {},
      macro: ctx.macro,
    };
    let out = null;
    try { out = await runMacro("lens", "delete", { id: artifactId }, stranger); } catch { out = null; }
    assert.notEqual(out?.ok, true, "stranger delete must not succeed");
    assert.equal(STATE.lensArtifacts.has(artifactId), true, "artifact survives");
    for (const e of exhausts) assert.equal(STATE.dtus.has(e.id), true, "family survives");
  });
});
