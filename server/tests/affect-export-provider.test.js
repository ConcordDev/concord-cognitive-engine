// S-AFF-8 pins (build(affect)) — F15's export half.
//
// Mood check-ins live in per-user state (STATE.affectMood), not the
// generic artifact store, so the shared lens export (Q79,
// lib/lens-export.js) contained none of them and the export surface
// declared "no saved data" over standing records. Affect now registers
// an export provider in the documented adoption shape (calendar /
// poetry / veterinary precede it): the caller's own check-ins, scoped
// to the caller.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAffectActions from "../domains/affect.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}, data = {}) {
  const fn = ACTIONS.get(`affect.${name}`);
  if (!fn) throw new Error(`affect.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  registerAffectActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const noArtifacts = async () => ({ ok: true, artifacts: [] });

describe("S-AFF-8 affect export provider (F15)", () => {
  it("affect is registered as a state-backed export domain", () => {
    assert.equal(hasLensExportProvider("affect"), true);
  });

  it("the caller's check-ins are export rows", async () => {
    call("checkin", ctxA, { mood: 4, note: "export me", activities: ["walk"] });
    call("checkin", ctxA, { mood: 2 });
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "affect", ctx: ctxA });
    assert.equal(out.ok, true);
    assert.equal(out.stateBacked, true);
    assert.equal(out.sources.stateRecords, 2);
    assert.equal(out.total, 2);
    const row = out.artifacts.find((r) => r.data && r.data.note === "export me");
    assert.ok(row, "the noted check-in is an export row");
    assert.equal(row.type, "mood-checkin");
    assert.match(row.title, /Good/);
  });

  it("rows are scoped to the caller — another user exports none of them", async () => {
    call("checkin", ctxA, { mood: 4 });
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "affect", ctx: ctxB });
    assert.equal(out.total, 0);
    assert.equal(out.sources.stateRecords, 0);
  });
});
