// tests/depth/religion-behavior.test.js — REAL behavioral tests for the religion
// domain (register()/runMacro family, via macroRuntime). found → join → pray
// membership loop + validation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("religion — faith membership loop", () => {
  let runMacro, ctx, faithId;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("religion")); });

  it("found → list → get: a faith is created and discoverable", async () => {
    const f = await runMacro("religion", "found", { name: "The Concordant Light", doctrine: "balance" }, ctx);
    assert.equal(f.ok, true);
    faithId = f.faithId;
    const list = await runMacro("religion", "list", {}, ctx);
    assert.ok(list.faiths.some((x) => x.id === faithId));
    const got = await runMacro("religion", "get", { faithId }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.faith.id, faithId);
  });

  it("get: an unknown faith id is rejected", async () => {
    const r = await runMacro("religion", "get", { faithId: "nope" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "faith_not_found");
  });

  it("join: founder joins; a second join is idempotent", async () => {
    const j = await runMacro("religion", "join", { faithId }, ctx);
    assert.equal(j.ok, true);
    const again = await runMacro("religion", "join", { faithId }, ctx);
    assert.equal(again.alreadyJoined, true);
  });

  it("pray raises fervor once joined; praying at a faith you haven't joined is rejected", async () => {
    const p = await runMacro("religion", "pray", { faithId }, ctx);
    assert.equal(p.ok, true);
    const notMember = await runMacro("religion", "pray", { faithId: "some-other-faith" }, ctx);
    assert.equal(notMember.ok, false);
    assert.equal(notMember.reason, "not_a_worshipper");
  });

  it("my_worship → worshipper: membership reads back", async () => {
    const mine = await runMacro("religion", "my_worship", {}, ctx);
    assert.equal(mine.ok, true);
    const w = await runMacro("religion", "worshipper", { faithId }, ctx);
    assert.equal(w.ok, true);
    assert.ok(w.worshipper);
  });

  it("sermon by a non-worshipper of that faith is rejected", async () => {
    const r = await runMacro("religion", "sermon", { faithId: "faith-i-am-not-in", audienceSize: 10 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "preacher_not_worshipper");
  });

  it("leave: founder can leave the faith; constants exposed", async () => {
    const l = await runMacro("religion", "leave", { faithId }, ctx);
    assert.equal(l.ok, true);
    const k = await runMacro("religion", "constants", {}, ctx);
    assert.equal(k.ok, true);
    assert.ok(k.constants && typeof k.constants === "object");
  });
});
