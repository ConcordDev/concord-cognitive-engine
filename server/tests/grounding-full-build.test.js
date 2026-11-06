// Grounding full-build tests (B6, F-C row 22) — the premise's priced legs:
//   S5 entailment: aggregateEvidence's stance inference judges a plainly
//     factual excerpt against the CLAIM's content when no verdict-words are
//     present (a restatement supports; a negated restatement contradicts;
//     unrelated text stays neutral). Keyword behaviour and caller-supplied
//     stances are unchanged, and the result notes define the measure.
//   S2 exits (server.js Reality Anchor): the engine + macro text is
//     extracted from server.js and driven with stubs — remove_sensor /
//     remove_reading are owner-scoped (another account's object reads as
//     "not found", the record_reading precedent), sensor removal cascades
//     its readings, propose_action stamps its proposer, and withdraw_action
//     is the proposer's exit (legacy unstamped actions are role-held under
//     A11 — the register's pricing superseding the build premise's filing).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import registerGroundingActions from "../domains/grounding.js";

// ---------------------------------------------------------------------------
// Part A — domains/grounding.js aggregateEvidence entailment
// ---------------------------------------------------------------------------
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`grounding.${name}`);
  if (!fn) throw new Error(`grounding.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerGroundingActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const CLAIM = "Global renewable energy capacity doubled between 2015 and 2023";

describe("grounding full build — aggregateEvidence entailment (S5)", () => {
  it("a plainly factual restatement with no verdict-words classifies supports", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "Global renewable capacity reached 3,870 GW in 2023, double the 2015 level, IRENA figures state.", sourceUrl: "irena.org" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].stance, "supports");
    assert.equal(r.result.probabilityTrue, 1);
  });

  it("a negated restatement classifies contradicts", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "Global renewable energy capacity did not double between 2015 and 2023.", sourceUrl: "example.org" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].stance, "contradicts");
    assert.equal(r.result.probabilityTrue, 0);
  });

  it("unrelated evidence stays neutral and out of the decisive share", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "The city council approved the new bus schedule on Tuesday.", sourceUrl: "example.org" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].stance, "neutral");
    assert.equal(r.result.verdict, "unverifiable");
  });

  it("verdict-word behaviour is preserved (keyword signal still decides first)", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "Studies confirmed and verified the doubling.", sourceUrl: "reuters.com" }],
    });
    assert.equal(r.result.citations[0].stance, "supports");
  });

  it("a caller-supplied stance still wins over inference", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "Global renewable capacity reached 3,870 GW in 2023, double the 2015 level.", sourceUrl: "irena.org", stance: "neutral" }],
    });
    assert.equal(r.result.citations[0].stance, "neutral");
  });

  it("the result notes define the measure probabilityTrue names", () => {
    const r = call("aggregateEvidence", ctxA, {
      claim: CLAIM,
      evidence: [{ text: "Studies confirmed the doubling.", sourceUrl: "reuters.com" }],
    });
    assert.match(r.result.notes, /evidence measure, not a measured probability/);
  });
});

// ---------------------------------------------------------------------------
// Part B — server.js Reality Anchor exits, extracted and driven with stubs
// ---------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
function sliceBlock(startMarker, endMarker) {
  const a = serverSrc.indexOf(startMarker);
  const b = serverSrc.indexOf(endMarker);
  assert.ok(a !== -1 && b !== -1 && b > a, `block markers found: ${startMarker}`);
  return serverSrc.slice(a, b + endMarker.length);
}
const engineCode = sliceBlock("// ===== EMBODIMENT/GROUNDING SYSTEM =====", "// ===== END EMBODIMENT/GROUNDING SYSTEM =====");
const macroCode = sliceBlock("// ===== GROUNDING MACROS =====", "// ===== END GROUNDING MACROS =====");

function buildRig() {
  const STATE = {};
  let n = 0;
  const macros = new Map();
  const uid = (p) => `${p}_${++n}`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nowISO = () => new Date().toISOString();
  const saveStateDebounced = () => {};
  const enforceEthosInvariant = () => true;
  const lensRequireActor = (ctx) => (ctx?.actor?.userId ? { ok: true, actorId: ctx.actor.userId } : { ok: false });
  const lensRequireOwner = (ctx, ownerId) => ({ ok: !!ctx?.actor?.userId && ctx.actor.userId === ownerId });
  const register = (domain, name, fn) => macros.set(name, fn);
  // eslint-disable-next-line no-new-func -- deliberate: the suite drives server.js's own extracted engine+macro text, it does not generate code from input
  const factory = new Function(
    "STATE", "uid", "clamp", "nowISO", "saveStateDebounced",
    "enforceEthosInvariant", "lensRequireActor", "lensRequireOwner", "register",
    `${engineCode}\n${macroCode}\nreturn { macros: null, fns: { registerSensor, recordSensorReading, removeSensor, removeReading, proposeAction, withdrawAction, approveAction } };`,
  );
  const { fns } = factory(STATE, uid, clamp, nowISO, saveStateDebounced, enforceEthosInvariant, lensRequireActor, lensRequireOwner, register);
  const ctxFor = (userId, role = "member") => ({ state: STATE, actor: { userId, role } });
  const macro = (name, ctx, input) => macros.get(name)(ctx, input);
  return { STATE, fns, macros, ctxFor, macro };
}

describe("grounding full build — Reality Anchor exits (S2)", () => {
  it("remove_sensor is owner-scoped and cascades the sensor's readings", () => {
    const { STATE, fns, ctxFor, macro } = buildRig();
    const a = ctxFor("user_a");
    const reg = macro("register_sensor", a, { name: "PR2 Grounding Sensor 1031", type: "temperature", unit: "C" });
    assert.equal(reg.ok, true);
    const sid = reg.sensor.id;
    assert.equal(reg.sensor.ownerId, "user_a");
    const rd = macro("record_reading", a, { sensorId: sid, value: 21.5 });
    assert.equal(rd.ok, true);
    assert.equal(STATE.grounding.readings.length, 1);

    // Another account's sensor reads as not found.
    const refused = macro("remove_sensor", ctxFor("user_b"), { sensorId: sid });
    assert.deepEqual(refused, { ok: false, error: "Sensor not found" });
    assert.equal(STATE.grounding.sensors.size, 1);

    const removed = macro("remove_sensor", a, { sensorId: sid });
    assert.equal(removed.ok, true);
    assert.equal(removed.removed.readingsRemoved, 1);
    assert.equal(STATE.grounding.sensors.size, 0);
    assert.equal(STATE.grounding.readings.length, 0);
    assert.equal(typeof fns.removeSensor, "function");
  });

  it("remove_reading is owner-scoped via the parent sensor and keeps lastReading honest", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const a = ctxFor("user_a");
    const sid = macro("register_sensor", a, { name: "S", type: "custom", unit: "" }).sensor.id;
    const r1 = macro("record_reading", a, { sensorId: sid, value: 1 }).reading;
    const r2 = macro("record_reading", a, { sensorId: sid, value: 2 }).reading;
    assert.equal(STATE.grounding.sensors.get(sid).lastReading.id, r2.id);

    assert.deepEqual(macro("remove_reading", ctxFor("user_b"), { readingId: r2.id }), { ok: false, error: "Reading not found" });
    const removed = macro("remove_reading", a, { readingId: r2.id });
    assert.equal(removed.ok, true);
    assert.equal(STATE.grounding.readings.length, 1);
    assert.equal(STATE.grounding.sensors.get(sid).lastReading.id, r1.id);
    assert.deepEqual(macro("remove_reading", a, { readingId: "reading_nope" }), { ok: false, error: "Reading not found" });
  });

  it("propose stamps the proposer; withdraw is the proposer's exit", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const a = ctxFor("user_a");
    const proposed = macro("propose_action", a, { type: "notification", description: "PR2 pending" });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.action.proposedBy, "user_a");
    const aid = proposed.action.id;
    assert.equal(STATE.grounding.pendingActions.length, 1);

    const refused = macro("withdraw_action", ctxFor("user_b"), { actionId: aid });
    assert.deepEqual(refused, { ok: false, error: "Only the proposer can withdraw this action" });
    assert.equal(STATE.grounding.pendingActions.length, 1);

    const done = macro("withdraw_action", a, { actionId: aid });
    assert.equal(done.ok, true);
    assert.equal(STATE.grounding.pendingActions.length, 0);
    assert.equal(STATE.grounding.actionHistory.length, 1);
    assert.equal(STATE.grounding.actionHistory[0].status, "withdrawn");
  });

  it("a legacy unstamped action is role-held under A11 (a plain account is refused); unknown ids answer honestly", () => {
    const { STATE, ctxFor, macro } = buildRig();
    macro("propose_action", ctxFor("user_a"), { type: "notification", description: "x" });
    // Simulate a pre-stamping action: no proposer recorded.
    delete STATE.grounding.pendingActions[0].proposedBy;
    const aid = STATE.grounding.pendingActions[0].id;
    // A11 (superseding this case's original expectation, which filed the
    // hole as design): a plain signed-in account is refused; the exit is
    // role-held.
    const refused = macro("withdraw_action", ctxFor("user_b"), { actionId: aid });
    assert.deepEqual(refused, { ok: false, error: "Only the proposer can withdraw this action" });
    assert.equal(STATE.grounding.pendingActions.length, 1);
    const done = macro("withdraw_action", ctxFor("user_b", "admin"), { actionId: aid });
    assert.equal(done.ok, true);
    assert.deepEqual(macro("withdraw_action", ctxFor("user_b"), { actionId: "action_nope" }), { ok: false, error: "Action not found" });
  });

  it("an owner/admin role may withdraw another account's stamped action (approve-gate mirror)", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const proposed = macro("propose_action", ctxFor("user_a"), { type: "notification", description: "x" });
    const done = macro("withdraw_action", ctxFor("user_b", "admin"), { actionId: proposed.action.id });
    assert.equal(done.ok, true);
    assert.equal(STATE.grounding.pendingActions.length, 0);
  });
});
