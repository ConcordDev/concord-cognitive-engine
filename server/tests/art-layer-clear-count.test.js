// GB-1538 / FIX-art-009 — head-check pin: the Studio card's stroke count
// is artwork-list's live sum over stored layers, so after layer-clear it
// must read 0. This drives the real domain actions end to end:
// create → commit two strokes → clear the layer → list.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerArtActions from "../domains/art.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "u_art" } };
function call(name, params) {
  const fn = ACTIONS.get(`art.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  globalThis._concordSTATE = {};
  registerArtActions(register);
});

describe("art layer-clear empties the listed stroke count (FIX-art-009)", () => {
  it("create → 2 strokes → clear → artwork-list strokeCount is 0", () => {
    const created = call("artwork-create", { title: "probe", width: 200, height: 200 });
    assert.equal(created.ok, true);
    const art = created.result.artwork;
    const layerId = art.layers[0].id;
    const stroke = { points: [[1, 1], [5, 5]], color: "#000000", size: 2, tool: "brush" };
    assert.equal(call("stroke-commit", { artworkId: art.id, layerId, stroke }).ok, true);
    assert.equal(call("stroke-commit", { artworkId: art.id, layerId, stroke }).ok, true);
    let list = call("artwork-list", {});
    assert.equal(list.result.artworks.find((a) => a.id === art.id).strokeCount, 2);
    assert.equal(call("layer-clear", { artworkId: art.id, layerId }).ok, true);
    list = call("artwork-list", {});
    assert.equal(list.result.artworks.find((a) => a.id === art.id).strokeCount, 0);
  });
});
