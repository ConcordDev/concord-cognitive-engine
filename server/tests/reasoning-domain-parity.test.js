// Contract tests for server/domains/reasoning.js
//
// Covers the two macro families:
//   1. Stateless analysis engines (logicValidate, argumentMap,
//      fallacyDetect, premiseExtract).
//   2. The persistent argument-map substrate that backs the Kialo-style
//      ArgumentMapStudio frontend: map CRUD, node CRUD + pro/con
//      branching, strength-weighted evidence, collaborative debate,
//      conclusion-confidence scoring, export, and the reasoning-scheme
//      library.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerReasoningActions from "../domains/reasoning.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`reasoning.${name}`);
  if (!fn) throw new Error(`reasoning.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerReasoningActions(register); });

// Fresh STATE for every test so per-user maps don't leak.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a", displayName: "Ada" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", displayName: "Bob" }, userId: "user_b" };

/* ---------------------------------------------------------------- */
/*  Stateless analysis engines                                       */
/* ---------------------------------------------------------------- */

describe("reasoning — stateless analysis engines", () => {
  it("logicValidate flags contradictions and computes term support", () => {
    const r = call("logicValidate", ctxA, {
      data: { premises: ["All birds fly", "Penguins are birds"], conclusion: "Penguins fly" },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.premiseCount, 2);
    assert.ok("validity" in r.result);
  });

  it("argumentMap builds a strength map from claims", () => {
    const r = call("argumentMap", ctxA, {
      data: { claims: [
        { id: "c1", text: "Thesis", type: "thesis" },
        { id: "c2", text: "Support", supports: ["c1"] },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalClaims, 2);
    assert.ok(r.result.strengthMap.c1);
  });

  it("fallacyDetect surfaces matched fallacy patterns", () => {
    const r = call("fallacyDetect", ctxA, {
      data: { text: "You're just saying that because everyone knows experts say so." },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.fallaciesDetected >= 1);
  });

  it("premiseExtract classifies premises and conclusions", () => {
    const r = call("premiseExtract", ctxA, {
      data: { text: "Since the data shows growth, therefore we should invest." },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.totalSentences >= 1);
  });
});

/* ---------------------------------------------------------------- */
/*  Persistent argument-map substrate                                */
/* ---------------------------------------------------------------- */

describe("reasoning — map CRUD", () => {
  it("map-create requires title and rootClaim", () => {
    assert.equal(call("map-create", ctxA, {}).ok, false);
    assert.equal(call("map-create", ctxA, { title: "X" }).ok, false);
  });

  it("map-create / map-list / map-get round-trip", () => {
    const created = call("map-create", ctxA, { title: "Remote work", rootClaim: "Remote work is better" });
    assert.equal(created.ok, true);
    const mapId = created.result.map.id;
    assert.ok(mapId);

    const list = call("map-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.maps.length, 1);

    const got = call("map-get", ctxA, { mapId });
    assert.equal(got.ok, true);
    assert.equal(got.result.map.nodes.length, 1);
    assert.equal(got.result.map.nodes[0].type, "claim");
  });

  it("map-update changes status; map-delete removes it", () => {
    const mapId = call("map-create", ctxA, { title: "T", rootClaim: "C" }).result.map.id;
    const upd = call("map-update", ctxA, { mapId, status: "concluded" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.map.status, "concluded");
    assert.equal(call("map-update", ctxA, { mapId, status: "bogus" }).ok, false);

    const del = call("map-delete", ctxA, { mapId });
    assert.equal(del.ok, true);
    assert.equal(call("map-list", ctxA, {}).result.maps.length, 0);
  });
});

describe("reasoning — node CRUD + pro/con branching", () => {
  it("node-add attaches pro and con children to the root", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root" }).result.map;
    const rootId = map.nodes[0].id;
    const pro = call("node-add", ctxA, { mapId: map.id, parentId: rootId, text: "Supports it", stance: "pro" });
    assert.equal(pro.ok, true);
    assert.equal(pro.result.node.stance, "pro");
    const con = call("node-add", ctxA, { mapId: map.id, parentId: rootId, text: "Opposes it", stance: "con" });
    assert.equal(con.ok, true);
    assert.equal(con.result.node.stance, "con");

    const got = call("map-get", ctxA, { mapId: map.id });
    assert.equal(got.result.map.nodes[0].children.length, 2);
  });

  it("node-update edits strength/stance; node-delete cannot remove root", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root" }).result.map;
    const rootId = map.nodes[0].id;
    const child = call("node-add", ctxA, { mapId: map.id, parentId: rootId, text: "Child", stance: "pro" }).result.node;

    const upd = call("node-update", ctxA, { mapId: map.id, nodeId: child.id, strength: 5, stance: "con" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.node.strength, 5);
    assert.equal(upd.result.node.stance, "con");

    assert.equal(call("node-delete", ctxA, { mapId: map.id, nodeId: rootId }).ok, false);
    assert.equal(call("node-delete", ctxA, { mapId: map.id, nodeId: child.id }).ok, true);
  });
});

describe("reasoning — strength-weighted evidence", () => {
  it("evidence-attach links evidence with credibility/relevance/weight", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root" }).result.map;
    const rootId = map.nodes[0].id;
    const att = call("evidence-attach", ctxA, {
      mapId: map.id, nodeId: rootId,
      title: "Stanford study", source: "Stanford", evidenceType: "empirical_study",
      credibility: 5, relevance: 4, weight: 3,
    });
    assert.equal(att.ok, true);
    assert.equal(att.result.evidence.credibility, 5);
    assert.ok(att.result.score > 0);

    const det = call("evidence-detach", ctxA, { mapId: map.id, nodeId: rootId, evidenceId: att.result.evidence.id });
    assert.equal(det.ok, true);
  });

  it("evidence-attach requires a title", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root" }).result.map;
    const r = call("evidence-attach", ctxA, { mapId: map.id, nodeId: map.nodes[0].id });
    assert.equal(r.ok, false);
  });
});

describe("reasoning — collaborative debate", () => {
  it("collaborator-add lets a second user see + edit the map", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root" }).result.map;
    assert.equal(call("map-get", ctxB, { mapId: map.id }).ok, false);

    const add = call("collaborator-add", ctxA, { mapId: map.id, collaboratorId: "user_b" });
    assert.equal(add.ok, true);
    assert.ok(add.result.collaborators.includes("user_b"));

    const seen = call("map-get", ctxB, { mapId: map.id });
    assert.equal(seen.ok, true);
    // Collaborator can branch the map.
    const branch = call("node-add", ctxB, { mapId: map.id, parentId: map.nodes[0].id, text: "Bob's point", stance: "con" });
    assert.equal(branch.ok, true);

    const rm = call("collaborator-remove", ctxA, { mapId: map.id, collaboratorId: "user_b" });
    assert.equal(rm.ok, true);
    assert.equal(call("map-get", ctxB, { mapId: map.id }).ok, false);
  });
});

describe("reasoning — argument scoring + export", () => {
  it("map-score computes conclusion confidence and a verdict", () => {
    const map = call("map-create", ctxA, { title: "T", rootClaim: "Root claim" }).result.map;
    const rootId = map.nodes[0].id;
    call("node-add", ctxA, { mapId: map.id, parentId: rootId, text: "Strong support", stance: "pro", strength: 5 });
    const score = call("map-score", ctxA, { mapId: map.id });
    assert.equal(score.ok, true);
    assert.ok(typeof score.result.confidence === "number");
    assert.ok(typeof score.result.verdict === "string");
    assert.ok(Array.isArray(score.result.perNode));
  });

  it("map-export renders markdown, outline, and json", () => {
    const map = call("map-create", ctxA, { title: "Export test", rootClaim: "Root" }).result.map;
    for (const format of ["markdown", "outline", "json"]) {
      const r = call("map-export", ctxA, { mapId: map.id, format });
      assert.equal(r.ok, true, `${format} export should succeed`);
      assert.ok(r.result.content.length > 0);
    }
    assert.equal(call("map-export", ctxA, { mapId: map.id, format: "pdf" }).ok, false);
  });
});

describe("reasoning — reasoning-scheme library", () => {
  it("scheme-list returns the scheme catalogue", () => {
    const r = call("scheme-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.schemes.length >= 5);
    assert.ok(r.result.schemes.every((s) => Array.isArray(s.slots)));
  });

  it("scheme-instantiate builds a persistent map from a scheme", () => {
    const r = call("scheme-instantiate", ctxA, {
      schemeId: "syllogism",
      values: {
        "Major Premise": "All humans are mortal",
        "Minor Premise": "Socrates is human",
        "Conclusion": "Socrates is mortal",
      },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.map.id);
    assert.ok(r.result.map.nodes[0].children.length >= 1);
    assert.ok(Array.isArray(r.result.criticalQuestions));
    // The instantiated map is persisted and listable.
    assert.equal(call("map-list", ctxA, {}).result.maps.length, 1);
  });

  it("scheme-instantiate rejects an unknown scheme", () => {
    assert.equal(call("scheme-instantiate", ctxA, { schemeId: "nonexistent" }).ok, false);
  });
});
