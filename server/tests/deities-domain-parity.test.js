// Contract tests for server/domains/deities.js — the in-game pantheon
// system (player-composed patron deities). Every macro is exercised and
// asserted to return { ok: true } on the happy path, plus the load-bearing
// gameplay invariants: alignment-gated reception, devotion accrual,
// author-only editing, and alignment-gated blessing claims.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDeitiesActions from "../domains/deities.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`deity.${name}`);
  if (!fn) throw new Error(`deity.${name} not registered`);
  const artifact = { id: null, domain: "deity", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerDeitiesActions(register); });

// Each test gets a clean substrate.
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.deitiesLens;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function composeBasic(ctx = ctxA, over = {}) {
  return call("compose", ctx, {
    name: over.name || "Veyra",
    toneVector: over.toneVector || { warmth: 0.7, refusal: 0.2, mystery: 0.6 },
    alignmentThresholds: over.alignmentThresholds || { commune: 0.5, refuse: -0.3 },
    domainTitle: over.domainTitle,
    creed: over.creed,
  });
}

describe("deity.compose / list", () => {
  it("composes a deity and returns its id + summary", () => {
    const r = composeBasic();
    assert.equal(r.ok, true);
    assert.ok(r.result.deityId);
    assert.equal(r.result.deity.name, "Veyra");
    assert.equal(r.result.deity.pilgrim_count, 0);
  });

  it("rejects an empty name", () => {
    const r = call("compose", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("lists composed deities ranked by pilgrim count", () => {
    composeBasic(ctxA, { name: "Alpha" });
    composeBasic(ctxA, { name: "Beta" });
    const r = call("list", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
  });
});

describe("deity.detail", () => {
  it("returns tone vector, templates, roster + my devotion", () => {
    const id = composeBasic().result.deityId;
    const r = call("detail", ctxA, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.isAuthor, true);
    assert.ok(r.result.deity.toneVector);
    assert.ok(Array.isArray(r.result.deity.dialogueTemplates));
    assert.ok(Array.isArray(r.result.pilgrimRoster));
  });

  it("rejects a missing deity", () => {
    assert.equal(call("detail", ctxA, { deityId: "nope" }).ok, false);
    assert.equal(call("detail", ctxA, {}).ok, false);
  });
});

describe("deity.revise (author-only)", () => {
  it("lets the author revise tone + bumps revision", () => {
    const id = composeBasic().result.deityId;
    const r = call("revise", ctxA, { deityId: id, toneVector: { warmth: 0.1, refusal: 0.9, mystery: 0.5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.revision, 2);
  });

  it("INVARIANT: a non-author cannot revise", () => {
    const id = composeBasic(ctxA).result.deityId;
    const r = call("revise", ctxB, { deityId: id, name: "Hijack" });
    assert.equal(r.ok, false);
    assert.match(r.error, /author/);
  });
});

describe("deity.pilgrimage", () => {
  it("records a pilgrim, bumps count, accrues devotion", () => {
    const id = composeBasic().result.deityId;
    const r = call("pilgrimage", ctxA, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.newPilgrimCount, 1);
    assert.ok(r.result.devotion.score > 0);
  });

  it("supports a federated originPeer", () => {
    const id = composeBasic().result.deityId;
    const r = call("pilgrimage", ctxB, { deityId: id, originPeer: "peer.example.org" });
    assert.equal(r.ok, true);
    const log = call("pilgrim_log", ctxA, { deityId: id });
    assert.equal(log.result.pilgrims[0].origin_peer, "peer.example.org");
  });
});

describe("deity.search", () => {
  it("filters by query, tone axis, and popularity", () => {
    const cold = composeBasic(ctxA, { name: "Frostheart", toneVector: { warmth: 0.05, refusal: 0.9, mystery: 0.5 } }).result.deityId;
    composeBasic(ctxA, { name: "Sunwarm", toneVector: { warmth: 0.95, refusal: 0.1, mystery: 0.2 } });
    call("pilgrimage", ctxB, { deityId: cold });
    const byName = call("search", ctxA, { query: "frost" });
    assert.equal(byName.ok, true);
    assert.equal(byName.result.count, 1);
    const byTone = call("search", ctxA, { toneAxis: "refusal", minTone: 0.5 });
    assert.equal(byTone.result.count, 1);
    const byPop = call("search", ctxA, { minPilgrims: 1 });
    assert.equal(byPop.result.count, 1);
  });
});

describe("deity.commune (alignment-gated)", () => {
  it("greets a neutral-alignment player", () => {
    const id = composeBasic().result.deityId;
    const r = call("commune", ctxB, { deityId: id, intent: "greet" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reception, "neutral");
    assert.ok(r.result.utterance.length > 0);
  });

  it("receives a high-alignment player after enough pilgrimage", () => {
    const id = composeBasic(ctxA, { alignmentThresholds: { commune: 0.3, refuse: -0.3 } }).result.deityId;
    for (let i = 0; i < 6; i++) call("pilgrimage", ctxB, { deityId: id });
    const r = call("commune", ctxB, { deityId: id, intent: "offering", offering: "a carved stone" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reception, "received");
  });

  it("commune_log returns recent utterances", () => {
    const id = composeBasic().result.deityId;
    call("commune", ctxB, { deityId: id });
    const r = call("commune_log", ctxA, { deityId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
  });
});

describe("deity.blessings / bless (gameplay payoff)", () => {
  it("lists blessing tiers with claimable state", () => {
    const id = composeBasic().result.deityId;
    const r = call("blessings", ctxB, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tiers.length, 4);
  });

  it("INVARIANT: cannot claim a blessing with too little devotion", () => {
    const id = composeBasic().result.deityId;
    const r = call("bless", ctxB, { deityId: id, tierId: "avatar" });
    assert.equal(r.ok, false);
  });

  it("grants a blessing once devotion + alignment are sufficient", () => {
    const id = composeBasic(ctxA, { alignmentThresholds: { commune: 0.3, refuse: -0.3 } }).result.deityId;
    for (let i = 0; i < 3; i++) call("pilgrimage", ctxB, { deityId: id });
    const granted = call("bless", ctxB, { deityId: id, tierId: "acolyte" });
    assert.equal(granted.ok, true);
    assert.ok(granted.result.blessing.effect.stat);
    // double-claim is rejected
    assert.equal(call("bless", ctxB, { deityId: id, tierId: "acolyte" }).ok, false);
    const mine = call("my_blessings", ctxB, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.result.count, 1);
  });
});

describe("deity.my_devotion", () => {
  it("tracks per-player devotion across the pantheon", () => {
    const a = composeBasic(ctxA, { name: "One" }).result.deityId;
    const b = composeBasic(ctxA, { name: "Two" }).result.deityId;
    call("pilgrimage", ctxB, { deityId: a });
    call("pilgrimage", ctxB, { deityId: a });
    call("pilgrimage", ctxB, { deityId: b });
    const r = call("my_devotion", ctxB, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.patronCount, 2);
    assert.equal(r.result.totalPilgrimages, 3);
    assert.ok(r.result.topPatron);
  });
});

describe("deity.tone_vector (legacy alias)", () => {
  it("returns tone vector + templates + thresholds", () => {
    const id = composeBasic().result.deityId;
    const r = call("tone_vector", ctxA, { deityId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.toneVector);
    assert.ok(Array.isArray(r.result.templates));
  });
});
