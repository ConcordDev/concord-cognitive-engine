// Megas/hypers inherit source "system" / visibility "internal" from the
// lattice members they absorb; they must stay visible to retrieval while
// system bookkeeping DTUs stay hidden and private DTUs stay private.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

let T; let saved;
describe("consolidated DTUs are retrievable", () => {
  before(async () => {
    const mod = await import("../server.js");
    _serverMod = mod;
    T = mod.__TEST__;
    saved = T.STATE.dtus;
    T.STATE.dtus = new Map();
  });
  after(() => { T.STATE.dtus = saved; });

  it("system/internal mega and hyper are visible, a system regular is hidden, private stays private", () => {
    const put = (d) => T.STATE.dtus.set(d.id, { status: "active", tags: [], ...d });
    put({ id: "v-mega", tier: "mega", title: "MEGA — Pier", source: "system", creatorType: "system", visibility: "internal", scope: "internal" });
    put({ id: "v-hyper", tier: "hyper", title: "HYPER — Pier", source: "system", visibility: "public", scope: "global" });
    put({ id: "v-sys", tier: "regular", title: "lattice audit", source: "lattice_audit", visibility: "internal" });
    put({ id: "v-priv-mega", tier: "mega", title: "MEGA — mine", visibility: "private", scope: "personal", ownerId: "owner-a", creator_id: "owner-a" });
    assert.equal(T._isHiddenSystemDtu(T.STATE.dtus.get("v-mega")), false);
    assert.equal(T._isHiddenSystemDtu(T.STATE.dtus.get("v-sys")), true);
    const ids = new Set(T.userVisibleDTUs("viewer-b").map(d => d.id));
    assert.equal(ids.has("v-mega"), true);
    assert.equal(ids.has("v-hyper"), true);
    assert.equal(ids.has("v-sys"), false);
    assert.equal(ids.has("v-priv-mega"), false);
  });

  it("formats archived hits with tier and archive marker", () => {
    const line = T.formatDtuHitsForPrompt([{ dtu: { tier: "mega", title: "MEGA — Pier", cretiHuman: "Gate opens 04:10" }, archived: true }]);
    assert.match(line, /^\[MEGA, archived\] MEGA — Pier: Gate opens 04:10/);
  });
});
