// crisis-ops full-build tests (B8, GB-1021) — hermetic, same harness shape
// as crisis-ops-lifecycle.test.js: register capture + :memory: world_crises.
//
// Pins the build's server slices:
//   C-S4 — crisis.alerts accepts its OWN cursor: the handler returns
//          cursor = Date.now() (epoch ms); the poll sends it back as
//          sinceMs and must not fail bad_numeric_field. Poison still fails.
//   C-S1 — triage ranks the console's own filed incident reports (lens
//          artifacts) alongside world crises; other users' reports and
//          other artifact types never enter the board.
//   C-S1 — resource_deploy moves the inventory totals without a crisisId
//          (checkpoint (1)'s server half: deploy 2 of 5 → 2 deployed / 3 avail).
//   C-S2 — playbook answers a catalogue read with no crisisType; team
//          answers a roles-only read with no crisisId; active_for_player
//          carries the declarable crisis types for the console's control.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCrisisMacros from "../domains/crisis.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "crisis");
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`crisis.${name} not registered`);
  return fn(ctx, input);
}

function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_crises (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, description TEXT,
      origin_world_id TEXT, started_at INTEGER, ends_at INTEGER,
      status TEXT DEFAULT 'active', resolved_by TEXT, outcome TEXT,
      resolved_at INTEGER
    );
    CREATE TABLE user_skills (user_id TEXT, skill_id TEXT, level INTEGER);
  `);
  return db;
}

const WORLD = "w_build";
const ctxFor = (db, userId = "op_1") => ({ db, actor: { userId }, userId });
let db;

before(() => {
  registerCrisisMacros(register);
  db = bootDb();
  globalThis._concordSTATE = { lensArtifacts: new Map() };
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO world_crises (id, type, description, origin_world_id, started_at, resolved_at)
              VALUES ('wc_1', 'faction_war', 'War in the hub', ?, ?, NULL)`).run(WORLD, nowSec - 3600);
  // The actor's own filed INFO report (the re-pass's standing fixture shape).
  globalThis._concordSTATE.lensArtifacts.set("rep_1", {
    id: "rep_1", domain: "crisis-ops", type: "incident_report", ownerId: "op_1",
    title: "PR2 marker report", createdAt: Date.now() - 30 * 60 * 1000,
    data: { severity: "info", body: "Standing by.", location: "North gate" },
    meta: { status: "info" },
  });
  // Negative controls: another user's report, and a non-report artifact.
  globalThis._concordSTATE.lensArtifacts.set("rep_2", {
    id: "rep_2", domain: "crisis-ops", type: "incident_report", ownerId: "someone_else",
    title: "Not yours", createdAt: Date.now(), data: { severity: "critical" }, meta: {},
  });
  globalThis._concordSTATE.lensArtifacts.set("other_1", {
    id: "other_1", domain: "crisis-ops", type: "note", ownerId: "op_1",
    title: "A note, not a report", createdAt: Date.now(), data: {}, meta: {},
  });
});

describe("C-S4 — alerts accepts its own epoch-ms cursor", () => {
  it("sinceMs = Date.now() (the returned cursor's scale) succeeds, twice in a row", async () => {
    const ctx = ctxFor(db);
    const first = await call("alerts", ctx, { worldId: WORLD, sinceMs: 0 });
    assert.equal(first.ok, true);
    assert.ok(Number.isFinite(first.result.cursor) && first.result.cursor > 1e12);
    const second = await call("alerts", ctx, { worldId: WORLD, sinceMs: first.result.cursor });
    assert.equal(second.ok, true, "the poll round-trip must not fail bad_numeric_field");
    const third = await call("alerts", ctx, { worldId: WORLD, sinceMs: Date.now() });
    assert.equal(third.ok, true);
  });

  it("poison sinceMs still fails closed", async () => {
    const ctx = ctxFor(db);
    for (const bad of [NaN, -1, Infinity, 1e308]) {
      const r = await call("alerts", ctx, { worldId: WORLD, sinceMs: bad });
      assert.equal(r.ok, false, `sinceMs=${bad} must reject`);
      assert.equal(r.reason, "bad_numeric_field");
      assert.equal(r.field, "sinceMs");
    }
  });
});

describe("C-S1 — triage ranks the console's own filed reports", () => {
  it("the actor's INFO report ranks beside the world crisis, source-labelled", async () => {
    const r = await call("triage", ctxFor(db), { worldId: WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.result.reports, 1);
    assert.equal(r.result.total, 2);
    const report = r.result.ranked.find((row) => row.source === "report");
    assert.ok(report, "the filed report must be on the board");
    assert.equal(report.id, "rep_1");
    assert.equal(report.type, "Incident report");
    assert.equal(report.description, "PR2 marker report");
    assert.equal(report.location, "North gate");
    // Freshness dominates the shared ladder by design (triageScore's own
    // urgency term): impact 0.30 (info) * 0.6 + urgency ~0.99 * 0.4 = ~58.
    assert.equal(report.triage.score, 58);
    assert.equal(report.triage.priority, "moderate");
    const world = r.result.ranked.find((row) => row.source === "world");
    assert.ok(world && world.id === "wc_1");
  });

  it("another user's report and a non-report artifact never enter the board", async () => {
    const r = await call("triage", ctxFor(db), { worldId: WORLD });
    const ids = r.result.ranked.map((row) => row.id);
    assert.ok(!ids.includes("rep_2"));
    assert.ok(!ids.includes("other_1"));
  });
});

describe("C-S1 — deploy moves the totals without a crisis", () => {
  it("deploy 2 of 5 -> DEPLOYED 2 / AVAILABLE 3; recall returns them", async () => {
    const ctx = ctxFor(db, "op_deploy");
    const up = await call("resource_upsert", ctx, { name: "Rescue boat", category: "general", quantity: 5, unit: "units" });
    assert.equal(up.ok, true);
    const resId = up.result.resource.id;
    const dep = await call("resource_deploy", ctx, { resourceId: resId, amount: 2 });
    assert.equal(dep.ok, true);
    assert.equal(dep.result.available, 3);
    const list = await call("resources", ctx, {});
    assert.equal(list.result.totals.deployed, 2);
    assert.equal(list.result.totals.available, 3);
    assert.equal(list.result.totals.total, 5);
    const over = await call("resource_deploy", ctx, { resourceId: resId, amount: 99 });
    assert.equal(over.ok, false);
    assert.equal(over.error, "insufficient_available");
    const rec = await call("resource_deploy", ctx, { resourceId: resId, amount: -2 });
    assert.equal(rec.ok, true);
    const after = await call("resources", ctx, {});
    assert.equal(after.result.totals.deployed, 0);
  });
});

describe("C-S2 — the library and command structure read without a live crisis", () => {
  it("playbook with no crisisType returns the catalogue", async () => {
    const r = await call("playbook", ctxFor(db), {});
    assert.equal(r.ok, true);
    const keys = r.result.playbooks.map((p) => p.key);
    assert.deepEqual(keys, ["flood", "wildfire", "earthquake", "storm", "outbreak", "default"]);
    assert.equal(r.result.playbooks[0].title, "Flood Response");
    assert.equal(r.result.playbooks[0].total, 6);
  });

  it("playbook with a crisisType still returns its steps", async () => {
    const r = await call("playbook", ctxFor(db), { crisisType: "flood" });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Flood Response");
    assert.equal(r.result.total, 6);
  });

  it("team with no crisisId returns the command roles, an empty roster", async () => {
    const r = await call("team", ctxFor(db), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.crisisId, null);
    assert.ok(r.result.roles.includes("incident_commander"));
    assert.ok(r.result.roles.includes("operations_chief"));
  });

  it("active_for_player carries the declarable crisis types", async () => {
    const r = await call("active_for_player", ctxFor(db), { worldId: WORLD });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.crisisTypes));
    assert.ok(r.crisisTypes.includes("faction_war"));
    assert.ok(r.crisisTypes.includes("dark_world"));
  });
});
