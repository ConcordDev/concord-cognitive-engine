// Post-#1809 §9 regression — the goalsLens state shape persisted by
// builds BEFORE #1809 lacks the sub-stores #1809 added (trash,
// chartPoints, occurrences). getGoalsState() must heal a legacy state
// in place: every remove routes through the trash store, Templates'
// occurrences list reads its store, and the chart/forecast series
// read chartPoints — on an unhealed state each of those throws a
// TypeError, which the live dispatch rewrites as "invalid_input"
// (removes, templates) or the handlers' own "handler_error"
// (chart, forecast). The other goals suites seed a fresh STATE, so
// they always see the complete current shape and cannot catch this.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "legacy-user" } };
const call = (name) => (p) => actions.get(`goals.${name}`)(ctx, null, p);

// The pre-#1809 init shape: exactly the fields the old getGoalsState
// created — no trash, no chartPoints, no occurrences.
function legacyState() {
  return {
    goalsLens: {
      objectives: new Map(),
      checkins: new Map(),
      team: new Map(),
      recurring: new Map(),
      reminders: new Map(),
      deps: new Map(),
      seq: new Map(),
    },
  };
}

beforeEach(() => { globalThis._concordSTATE = legacyState(); });

test("every remove + restore works on a legacy-shaped state", async () => {
  const tree = call("alignmentTree");
  const checkin = call("checkin");
  const reminder = call("reminder");
  const deps = call("dependencies");
  const teamGoal = call("teamGoal");
  const templates = call("templates");

  await tree({ op: "upsert", title: "Main" });
  await tree({ op: "upsert", title: "Child", parentId: "obj_1" });

  // objective remove + restore (trash store)
  const rmObj = await tree({ op: "remove", id: "obj_2" });
  assert.equal(rmObj.ok, true);
  assert.ok(rmObj.result.trashId);
  const rsObj = await tree({ op: "restore", trashId: rmObj.result.trashId });
  assert.equal(rsObj.ok, true);
  assert.equal(rsObj.result.flat.length, 2);

  // check-in remove
  const add = await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 40 });
  assert.equal(add.ok, true);
  const chkId = add.result.checkins[0].id;
  const rmChk = await checkin({ op: "remove", id: chkId });
  assert.equal(rmChk.ok, true);
  assert.ok(rmChk.result.trashId);

  // reminder remove
  const rem = await reminder({ op: "create", label: "Review", dueAt: "2999-01-01T00:00:00.000Z" });
  assert.equal(rem.ok, true);
  const remId = rem.result.reminder.id;
  const rmRem = await reminder({ op: "remove", id: remId });
  assert.equal(rmRem.ok, true);

  // dependency unlink
  const link = await deps({ op: "link", from: "obj_1", to: "obj_2", kind: "blocks" });
  assert.equal(link.ok, true);
  const unlink = await deps({ op: "unlink", from: "obj_1", to: "obj_2" });
  assert.equal(unlink.ok, true);
  assert.ok(unlink.result.trashId);

  // team goal remove
  const tg = await teamGoal({ op: "create", title: "Team goal", members: ["a"] });
  assert.equal(tg.ok, true);
  const tgId = tg.result.teamGoals[0].id;
  const rmTg = await teamGoal({ op: "remove", id: tgId });
  assert.equal(rmTg.ok, true);

  // recurring goal remove (via a template with a cadence)
  const applied = await templates({ op: "apply", templateId: "tpl_okr_quarter" });
  assert.equal(applied.ok, true);
  assert.ok(applied.result.recurring);
  const rmRec = await templates({ op: "recurring-remove", id: applied.result.recurring.id });
  assert.equal(rmRec.ok, true);
});

test("templates occurrences-list answers on a legacy-shaped state", async () => {
  const r = await call("templates")({ op: "occurrences-list" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.occurrences, []);
});

test("chart series and forecast read check-ins on a legacy-shaped state", async () => {
  const tree = call("alignmentTree");
  const checkin = call("checkin");
  await tree({ op: "upsert", title: "Main" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 40, period: "2026-10-01" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.8, progress: 60, period: "2026-10-15" });

  const series = await call("progressChart")({ op: "series", goalId: "obj_1", target: 100 });
  assert.equal(series.ok, true);
  assert.equal(series.result.points.length, 2);

  // The forecast is artifact-scoped: the live dispatch always passes
  // its virtualArtifact ({ data: <the call's input> }), so the test
  // calls it in that shape rather than with a null artifact.
  const fcParams = { goalId: "obj_1", target: 100 };
  const fc = await actions.get("goals.progressForecast")(ctx, { id: null, domain: "goals", type: "domain_action", data: fcParams, meta: {} }, fcParams);
  assert.equal(fc.ok, true);
  assert.ok(fc.result.currentState || fc.result.message);
});

test("a store revived as a plain object keeps its entries", async () => {
  // Persistence can revive a Map as a plain { userId: [...] } object.
  // Healing must convert it, not discard it.
  globalThis._concordSTATE = {
    goalsLens: {
      objectives: new Map(),
      checkins: new Map(),
      team: new Map(),
      recurring: new Map(),
      reminders: new Map(),
      deps: new Map(),
      seq: new Map(),
      trash: new Map(),
      occurrences: new Map(),
      chartPoints: {
        "legacy-user": [
          { id: "cp_1", goalId: "obj_1", date: "2026-10-10", progress: 55, createdAt: "2026-10-10T00:00:00.000Z" },
        ],
      },
    },
  };
  const tree = call("alignmentTree");
  await tree({ op: "upsert", title: "Main" });
  const series = await call("progressChart")({ op: "series", goalId: "obj_1", target: 100 });
  assert.equal(series.ok, true);
  assert.equal(series.result.points.length, 1);
  assert.equal(series.result.points[0].progress, 55);
});
