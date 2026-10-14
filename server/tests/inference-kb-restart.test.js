// INC-SWEEP inference F1 — Add Fact returned ok while kb-list / Facts tile
// stayed empty and reload wiped the KB. Desk add_fact wrote
// STATE.reasoning.knowledgeBase (process-local, not in lens snapshot);
// kb-list + tiles read STATE.inferenceLens. Fix: desk writes the same
// per-user inferenceLens store and survives serialize/hydrate restart.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInferenceActions from "../domains/inference.js";
import {
  addSpoFact,
  querySpoFacts,
  getDeskStatus,
  findFactById,
  actorIdFromCtx,
} from "../lib/inference-lens-kb.js";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`inference.${name}`);
  if (!fn) throw new Error(`inference.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

const ctxA = { actor: { userId: "user_inf_a" }, userId: "user_inf_a" };
const ctxB = { actor: { userId: "user_inf_b" }, userId: "user_inf_b" };

before(() => { registerInferenceActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("inference desk fact survives a snapshot restart", () => {
  it("registers inferenceLens on the snapshot key list", () => {
    assert.ok(LENS_STATE_KEYS.includes("inferenceLens"));
  });

  it("add → status + kb-list + query still see identical SPO after restart", () => {
    const owner = actorIdFromCtx(ctxA);
    const added = addSpoFact(owner, {
      subject: "sweepbird_srh1b",
      predicate: "is_a",
      object: "animal",
    });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.ok(added.fact.id.startsWith("fact_"));
    assert.equal(added.fact.subject, "sweepbird_srh1b");
    assert.equal(added.fact.predicate, "is_a");
    assert.equal(added.fact.object, "animal");

    const statusBefore = getDeskStatus(owner);
    assert.equal(statusBefore.factCount, 1);
    assert.equal(statusBefore.facts, 1, "tile aliases factCount");

    const listBefore = call("kb-list", ctxA);
    assert.equal(listBefore.ok, true);
    assert.equal(listBefore.result.factCount, 1);
    assert.equal(listBefore.result.facts[0].subject, "sweepbird_srh1b");
    assert.equal(listBefore.result.facts[0].predicate, "is_a");
    assert.equal(listBefore.result.facts[0].object, "animal");
    assert.equal(listBefore.result.facts[0].id, added.fact.id);

    const qBefore = querySpoFacts(owner, { subject: "sweepbird_srh1b" });
    assert.equal(qBefore.found, true);
    assert.equal(qBefore.facts[0].id, added.fact.id);

    const blob = restartFromSnapshot();
    assert.equal(blob.inferenceLens.kb.__type, "Map");
    assert.ok(JSON.stringify(blob.inferenceLens).includes("sweepbird_srh1b"));
    assert.ok(globalThis._concordSTATE.inferenceLens.kb instanceof Map);

    const statusAfter = getDeskStatus(owner);
    assert.equal(statusAfter.factCount, 1);
    assert.equal(statusAfter.facts, 1);

    const listAfter = call("kb-list", ctxA);
    assert.equal(listAfter.result.factCount, 1);
    assert.equal(listAfter.result.facts[0].id, added.fact.id);
    assert.equal(listAfter.result.facts[0].subject, "sweepbird_srh1b");
    assert.equal(listAfter.result.facts[0].predicate, "is_a");
    assert.equal(listAfter.result.facts[0].object, "animal");

    const qAfter = querySpoFacts(owner, { subject: "sweepbird_srh1b", predicate: "is_a", object: "animal" });
    assert.equal(qAfter.found, true);
    assert.equal(qAfter.facts[0].id, added.fact.id);
    assert.equal(qAfter.facts[0].subject, "sweepbird_srh1b");
  });

  it("acct2 kb-list / query / get-by-id cannot see acct1 fact after restart", () => {
    const a = actorIdFromCtx(ctxA);
    const b = actorIdFromCtx(ctxB);
    const added = addSpoFact(a, {
      subject: "private_bird",
      predicate: "is_a",
      object: "secret",
    });
    assert.equal(added.ok, true);
    const id = added.fact.id;

    restartFromSnapshot();

    assert.equal(call("kb-list", ctxB).result.factCount, 0);
    assert.equal(getDeskStatus(b).factCount, 0);
    assert.equal(querySpoFacts(b, { subject: "private_bird" }).found, false);
    assert.equal(findFactById(b, id), null);

    // Owner still has it
    assert.equal(call("kb-list", ctxA).result.factCount, 1);
    assert.ok(findFactById(a, id));
  });

  it("ignores client-supplied userId on the fact payload (auth actor owns it)", () => {
    const a = actorIdFromCtx(ctxA);
    const added = addSpoFact(a, {
      subject: "owned",
      predicate: "by",
      object: "auth",
      userId: "user_inf_b",
      ownerId: "user_inf_b",
    });
    assert.equal(added.ok, true);
    assert.equal(getDeskStatus(a).factCount, 1);
    assert.equal(getDeskStatus(actorIdFromCtx(ctxB)).factCount, 0);
  });
});
