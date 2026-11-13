// FIX-resonance-001 — INVESTIGATED drive (not a fix). The ticket: a
// proposed pair "is stored twice" — deleting the saved-item copy left
// the Workbench pair behind; only the Workbench's own Delete removed
// it. This drive establishes the branch's actual shape:
//   - the domain keeps exactly ONE pair store: proposePair writes it,
//     listPairs reads it, deletePair removes the pair AND the alerts
//     it raised (proven below, including the strong-signal alert);
//   - no second pair store exists in the domain for a saved-item
//     delete to act on — the only platform mechanism that mints a
//     second, deletable, user-titled copy of a lens record is the
//     lens-exhaust DTU (server.js _lensEmitDTU), whose presentation
//     as a user record in vault/corpus lists was FIX-science-003,
//     fixed at 7431275ce (lens_exhaust hidden from those lists).
// The desk's live re-walk decides whether the audit-era second copy
// is gone on prod; this drive pins the single-store lifecycle so it
// cannot silently fork again.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/resonance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`resonance.${name}`);
  if (!fn) throw new Error(`resonance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });
const ctxA = { actor: { userId: "u" }, userId: "u" };

const STRONG = {
  a: { domain: "immunology", title: "Adaptive immune memory", description: "lymphocyte clonal selection retains exposure",
       invariants: ["selective amplification of fit variants", "feedback regulation prevents runaway growth", "stored state enables faster future response"] },
  b: { domain: "economics", title: "Market price discovery", description: "trader bidding settles asset valuation",
       invariants: ["selective amplification of fit variants", "feedback regulation prevents runaway growth", "stored state enables faster future response"] },
};

describe("FIX-resonance-001 drive — one pair store", () => {
  it("propose -> list -> delete -> list: the pair exists exactly once and delete is total", () => {
    const r = call("proposePair", ctxA, STRONG);
    assert.equal(r.ok, true);
    const id = r.result.pair.id;
    let list = call("listPairs", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.pairs[0].id, id);
    const del = call("deletePair", ctxA, { pairId: id });
    assert.equal(del.ok, true);
    list = call("listPairs", ctxA, {});
    assert.equal(list.result.count, 0);
    // The strong-signal alert the proposal raised goes with the pair.
    const alerts = call("resonanceAlerts", ctxA, {});
    assert.equal((alerts.result.alerts || []).filter((a) => a.pairId === id).length, 0);
  });

  it("a duplicate proposal is refused, not stored a second time", () => {
    assert.equal(call("proposePair", ctxA, STRONG).ok, true);
    const again = call("proposePair", ctxA, STRONG);
    assert.equal(again.ok, false);
    assert.equal(call("listPairs", ctxA, {}).result.count, 1);
  });
});
