// INC-SWEEP research F4 — COMMON_ACTIONS share/rate (and flag mutators) must
// require a resolvable artifact id. /api/lens/run virtualArtifact={id:null}
// with {} must not fabricate shareUrl …/null or averageRating 5.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("COMMON_ACTIONS artifact id required (F4)", () => {
  let STATE, LENS_ACTIONS;

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  function researchHandler(name) {
    const fn = LENS_ACTIONS.get(`research.${name}`);
    assert.ok(typeof fn === "function", `research.${name} not registered`);
    return fn;
  }

  it("share and rate on virtual {} refuse with artifact id required (HTTP 422)", () => {
    const ctx = { actor: { userId: "u-f4", role: "member" } };
    const virtual = { id: null, domain: "research", type: "domain_action", data: {}, meta: {} };

    const share = researchHandler("share")(ctx, virtual, {});
    assert.equal(share.ok, false);
    assert.match(share.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(share).status, 422);

    const rate = researchHandler("rate")(ctx, virtual, {});
    assert.equal(rate.ok, false);
    assert.match(rate.error, /artifact id required/i);
    assert.equal(shapeLensRunHttp(rate).status, 422);
  });

  it("rate with artifact id but no rating refuses (no default 5)", () => {
    const ctx = { actor: { userId: "u-f4", role: "member" } };
    const art = {
      id: "lart_f4_rate",
      domain: "research",
      title: "Rate me",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);

    const noRating = researchHandler("rate")(ctx, art, {});
    assert.equal(noRating.ok, false);
    assert.match(noRating.error, /rating required/i);

    const ok = researchHandler("rate")(ctx, art, { rating: 4 });
    assert.equal(ok.ok, true);
    assert.equal(ok.averageRating, 4);
    assert.equal(ok.totalRatings, 1);
  });

  it("share with resolvable id returns a non-null shareUrl", () => {
    const ctx = { actor: { userId: "u-f4", role: "member" } };
    const art = {
      id: "lart_f4_share",
      domain: "research",
      title: "Share me",
      data: {},
      meta: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    STATE.lensArtifacts.set(art.id, art);

    const viaParams = researchHandler("share")(
      ctx,
      { id: null, domain: "research", data: {}, meta: {} },
      { id: art.id },
    );
    assert.equal(viaParams.ok, true);
    assert.equal(viaParams.shares, 1);
    assert.equal(viaParams.shareUrl, `/lenses/research/${art.id}`);
    assert.ok(!viaParams.shareUrl.endsWith("/null"));
  });

  it("flag actions (archive/bookmark/like) also refuse empty virtual artifact", () => {
    const ctx = { actor: { userId: "u-f4", role: "member" } };
    const virtual = { id: null, domain: "research", data: {}, meta: {} };
    for (const name of ["archive", "bookmark", "like", "lock", "pin", "star"]) {
      const r = researchHandler(name)(ctx, virtual, {});
      assert.equal(r.ok, false, `${name} should refuse`);
      assert.match(r.error, /artifact id required/i);
    }
  });
});
