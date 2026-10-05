// tests/astronomy-keep.test.js — REAL end-to-end proof for the Astronomy
// lens keep-and-draft workflow. Mirrors the established pattern:
// add a real target via `target-add`, log a real observation via
// `observation-log`, read it back via `observation-list`, save it as a
// private DTU via `dtu.create`, read that DTU back via `dtu.get`, then
// draft it in Thread via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("astronomy keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("astronomy-keep-proof"); });

  it("adds a real target, logs a real observation, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Add a real target via target-add.
    const tgtR = await lensRun("astronomy", "target-add", {
      params: { name: "Proof Galaxy", type: "galaxy", constellation: "Andromeda" },
    }, ctx);
    assert.equal(tgtR.ok, true, "target-add should succeed");
    const target = tgtR.result.target;
    assert.ok(target.id, "target should have an id");
    assert.equal(target.name, "Proof Galaxy");
    assert.equal(target.type, "galaxy");

    // 2. Log a real observation via observation-log.
    const obsR = await lensRun("astronomy", "observation-log", {
      params: {
        targetId: target.id,
        conditions: "clear",
        notes: "bright core",
        rating: 5,
      },
    }, ctx);
    assert.equal(obsR.ok, true, "observation-log should succeed");
    const obs = obsR.result.observation;
    assert.ok(obs.id, "observation should have an id");
    assert.equal(obs.targetId, target.id);
    assert.equal(obs.targetName, "Proof Galaxy");
    assert.equal(obs.rating, 5);
    assert.equal(obs.conditions, "clear");

    // 3. Read the real observation back via observation-list.
    const listR = await lensRun("astronomy", "observation-list", {}, ctx);
    assert.equal(listR.ok, true, "observation-list should succeed");
    const observations = listR.result.observations || [];
    const found = observations.find((o) => o.id === obs.id);
    assert.ok(found, "observation-list should include the created observation");

    // 4. Save the observation as a private DTU.
    const sentence = `${obs.date} Proof Galaxy: 5★ observation.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["astronomy", "observation"],
        source: "astronomy-lens:observation-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "astronomy_observation_report",
          observationId: obs.id,
          targetId: obs.targetId,
          targetName: obs.targetName,
          date: obs.date,
          rating: obs.rating,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "astronomy" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Astronomy observation — Proof Galaxy",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to log an observation with no target", async () => {
    const r = await lensRun("astronomy", "observation-log", { params: { targetId: "missing" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/target/i.test(r.result.error), "should reject missing target");
  });
});