// GET /api/dtus?tier=mega returned 0 whenever the Rust sidecar served the
// list: the sidecar never got #1542's mega/hyper exemption from the
// system-source filter, so every system-sourced public mega/hyper was dropped
// there while the in-memory path (used under event-loop lag) listed them.
// A sidecar body without consolidatedVisible now falls back for lists that
// can contain megas/hypers. Privacy and the "internal" boundary still hold.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { sidecarMayHideConsolidated, shouldFallbackFromSidecarList } from "../lib/dtu-list-source.js";

const VIEWER = "sc-viewer";
const OWNER = "sc-owner";

describe("sidecar list and consolidated DTUs", () => {
  it("a body without consolidatedVisible may hide megas for tier any/mega/hyper only", () => {
    const old = { ok: true, dtus: [], total: 0 };
    const fixed = { ok: true, dtus: [], total: 0, consolidatedVisible: true };
    for (const t of ["any", "mega", "hyper", "MEGA"]) assert.equal(sidecarMayHideConsolidated(old, t), true, t);
    for (const t of ["regular", "shadow", ""]) assert.equal(sidecarMayHideConsolidated(old, t), false, t);
    for (const t of ["any", "mega", "hyper"]) assert.equal(sidecarMayHideConsolidated(fixed, t), false, t);
    assert.equal(shouldFallbackFromSidecarList(old, { tier: "mega" }), true);
    assert.equal(shouldFallbackFromSidecarList(fixed, { tier: "mega" }), false);
    // mine lists are owner vaults: no ownerless system megas to lose.
    assert.equal(shouldFallbackFromSidecarList({ ok: true, dtus: [{ id: "x" }], total: 1 }, { tier: "any", mine: true }), false);
    // Callers that do not pass tier keep the previous decision.
    assert.equal(shouldFallbackFromSidecarList(old, {}), false);
  });

  let runMacro; let makeCtx; let STATE;
  before(async () => {
    const t = await load();
    runMacro = t.runMacro; makeCtx = t.makeCtx; STATE = t.STATE;
    const put = (d) => STATE.dtus.set(d.id, { status: "active", tags: [], createdAt: new Date().toISOString(), ...d });
    put({ id: "sc-pub-mega", tier: "mega", title: "MEGA — sc pier", source: "system", creatorType: "system", ownerId: "system", visibility: "public", scope: "global" });
    put({ id: "sc-pub-hyper", tier: "hyper", title: "HYPER — sc pier", creatorType: "system", ownerId: "system", visibility: "public", scope: "global" });
    put({ id: "sc-int-mega", tier: "mega", title: "MEGA — sc internal", creatorType: "system", visibility: "internal", scope: "local" });
    put({ id: "sc-priv-mega", tier: "mega", title: "MEGA — sc private", visibility: "private", scope: "local", ownerId: OWNER, creator_id: OWNER });
    put({ id: "sc-sys-reg", tier: "regular", title: "sc lattice audit", source: "lattice_audit", visibility: "public", scope: "global" });
  });
  after(() => {
    globalThis.__dtuSidecarList = undefined;
    for (const id of ["sc-pub-mega", "sc-pub-hyper", "sc-int-mega", "sc-priv-mega", "sc-sys-reg"]) STATE.dtus.delete(id);
  });

  const list = async (viewer, input) => {
    const ctx = makeCtx({ user: { id: viewer, role: "member" }, headers: {}, get() { return ""; } });
    const r = await runMacro("dtu", "list", { limit: 500, ...input }, ctx);
    return { r, ids: new Set((r.dtus || []).map((d) => d.id)) };
  };

  it("an old sidecar's empty mega list falls back and lists the public system mega/hyper", async () => {
    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [], total: 0 });
    const mega = await list(VIEWER, { tier: "mega" });
    assert.notEqual(mega.r._source, "dtu-sidecar");
    assert.equal(mega.ids.has("sc-pub-mega"), true);
    assert.equal(mega.ids.has("sc-int-mega"), false, "internal stays hidden");
    assert.equal(mega.ids.has("sc-priv-mega"), false, "another user's private mega stays hidden");
    const hyper = await list(VIEWER, { tier: "hyper" });
    assert.equal(hyper.ids.has("sc-pub-hyper"), true);
    const any = await list(VIEWER, {});
    assert.equal(any.ids.has("sc-pub-mega"), true);
    assert.equal(any.ids.has("sc-sys-reg"), false, "system-source regular DTUs stay hidden");
  });

  it("the owner still sees their private mega; nobody else does", async () => {
    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [], total: 0 });
    assert.equal((await list(OWNER, { tier: "mega" })).ids.has("sc-priv-mega"), true);
    assert.equal((await list(VIEWER, { tier: "mega" })).ids.has("sc-priv-mega"), false);
  });

  it("a fixed sidecar body is used as-is (fast path kept)", async () => {
    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [{ id: "from-sidecar", tier: "mega" }], total: 1, consolidatedVisible: true });
    const r = await list(VIEWER, { tier: "mega" });
    assert.equal(r.r._source, "dtu-sidecar");
    assert.deepEqual([...r.ids], ["from-sidecar"]);
  });

  it("a regular-tier list still uses an old sidecar", async () => {
    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [{ id: "reg-from-sidecar", tier: "regular" }], total: 1 });
    const r = await list(VIEWER, { tier: "regular" });
    assert.equal(r.r._source, "dtu-sidecar");
  });
});
