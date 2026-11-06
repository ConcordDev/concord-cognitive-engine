// A11 — legacy unstamped withdrawal: the four-beat matrix for the
// sibling verbs + the feeder, driving server.js's own extracted
// engine+macro text (the grounding-full-build harness form).
//
// The rule: where an object's ownership stamp is absent (pre-stamping
// legacy records), the exit is ROLE-HELD (owner/admin/founder, the
// approve gate's roles) — never public. And propose_action no longer
// mints unstamped actions: an actor that cannot be stamped is refused.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
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
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "STATE", "uid", "clamp", "nowISO", "saveStateDebounced",
    "enforceEthosInvariant", "lensRequireActor", "lensRequireOwner", "register",
    `${engineCode}\n${macroCode}\nreturn { fns: { registerSensor, recordSensorReading, removeSensor, removeReading, proposeAction, withdrawAction, approveAction } };`,
  );
  factory(STATE, uid, clamp, nowISO, saveStateDebounced, enforceEthosInvariant, lensRequireActor, lensRequireOwner, register);
  const ctxFor = (userId, role = "member") => ({ state: STATE, actor: userId ? { userId, role } : { role } });
  const macro = (name, ctx, input) => macros.get(name)(ctx, input);
  return { STATE, ctxFor, macro };
}

describe("A11 — the legacy rule on the sibling exits", () => {
  it("an unstamped sensor: plain account refused, admin allowed", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const sid = macro("register_sensor", ctxFor("user_a"), { name: "Legacy", type: "temperature", unit: "C" }).sensor.id;
    delete STATE.grounding.sensors.get(sid).ownerId;
    assert.deepEqual(macro("remove_sensor", ctxFor("user_b"), { sensorId: sid }), { ok: false, error: "Sensor not found" });
    assert.equal(STATE.grounding.sensors.size, 1);
    assert.equal(macro("remove_sensor", ctxFor("user_b", "admin"), { sensorId: sid }).ok, true);
    assert.equal(STATE.grounding.sensors.size, 0);
  });

  it("a reading under an unstamped sensor: plain account refused, admin allowed", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const a = ctxFor("user_a");
    const sid = macro("register_sensor", a, { name: "Legacy", type: "temperature", unit: "C" }).sensor.id;
    const rid = macro("record_reading", a, { sensorId: sid, value: 21.5 }).reading.id;
    delete STATE.grounding.sensors.get(sid).ownerId;
    assert.deepEqual(macro("remove_reading", ctxFor("user_b"), { readingId: rid }), { ok: false, error: "Reading not found" });
    assert.equal(macro("remove_reading", ctxFor("user_b", "admin"), { readingId: rid }).ok, true);
  });

  it("the feeder is closed: an unstampable propose refuses and creates nothing", () => {
    const { STATE, ctxFor, macro } = buildRig();
    const anon = macro("propose_action", ctxFor(null), { type: "notification", description: "x" });
    assert.equal(anon.ok, false);
    assert.equal(anon.error, "auth_required");
    assert.equal((STATE.grounding?.pendingActions || []).length, 0);
    const ok = macro("propose_action", ctxFor("user_a"), { type: "notification", description: "x" });
    assert.equal(ok.ok, true);
    assert.equal(ok.action.proposedBy, "user_a");
  });
});
