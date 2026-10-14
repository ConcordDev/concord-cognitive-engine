// INC-SWEEP agents F11 — prove batch 022 COMMON_ACTIONS id / blank-comment /
// duplicate gates on the Agents surface (share/rate/comment/duplicate/vote/assign).
// reset is an agents-domain LENS_ACTION (not COMMON) — covered separately below.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("agents F11 COMMON gates (ALREADY-CLOSED shared)", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  function agentsHandler(name) {
    const fn = LENS_ACTIONS.get(`agents.${name}`);
    assert.ok(typeof fn === "function", `agents.${name} not registered`);
    return fn;
  }

  it("share/rate/comment/duplicate/vote/assign on virtual {} refuse artifact id", () => {
    const ctx = { actor: { userId: "u-agt-f11", role: "member" } };
    const virtual = { id: null, domain: "agents", type: "domain_action", data: {}, meta: {} };
    for (const name of ["share", "rate", "comment", "duplicate", "vote", "assign"]) {
      const params = name === "comment" ? { text: "hi" } : name === "rate" ? { rating: 4 } : {};
      const out = agentsHandler(name)(ctx, virtual, params);
      assert.equal(out.ok, false, `${name} should refuse`);
      assert.match(out.error, /artifact id required/i, name);
      assert.equal(shapeLensRunHttp(out).status, 422, name);
    }
  });

  it("comment with artifact id but blank text refuses", () => {
    const ctx = { actor: { userId: "u-agt-f11", role: "member" } };
    const art = {
      id: "lart_agt_f11_cmt",
      domain: "agents",
      title: "Comment me",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);
    const blank = agentsHandler("comment")(ctx, art, { text: "   " });
    assert.equal(blank.ok, false);
    assert.match(blank.error, /comment text required|text required/i);
  });

  it("share with resolvable agents artifact returns non-null shareUrl", () => {
    const ctx = { actor: { userId: "u-agt-f11", role: "member" } };
    const art = {
      id: "lart_agt_f11_share",
      domain: "agents",
      title: "Share me",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);
    const out = agentsHandler("share")(ctx, art, { id: art.id });
    assert.equal(out.ok, true);
    assert.match(out.shareUrl, /lart_agt_f11_share/);
    assert.ok(!out.shareUrl.includes("null"));
  });

  it("agents.reset without a persisted artifact refuses (domain residue)", () => {
    const ctx = { actor: { userId: "u-agt-f11", role: "member" } };
    const virtual = { id: null, domain: "agents", type: "domain_action", data: {}, meta: {} };
    const out = agentsHandler("reset")(ctx, virtual, {});
    assert.equal(out.ok, false);
    assert.match(out.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(out).status, 422);
  });
});

