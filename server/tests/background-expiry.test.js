// PR-3: reversible TTL expiry + traceable task outcomes under the governor.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as G from "../lib/background-governor.js";

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_tasks (id TEXT PRIMARY KEY, emergent_id TEXT NOT NULL, task_type TEXT NOT NULL,
    task_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', priority INTEGER NOT NULL DEFAULT 50,
    created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, result TEXT);
    CREATE INDEX i1 ON emergent_tasks (status, task_type, created_at);
    CREATE TABLE emergent_communications (id TEXT PRIMARY KEY, from_emergent_id TEXT, to_emergent_id TEXT, intent TEXT,
    context TEXT, initiated_at INTEGER, status TEXT, response TEXT, completed_at INTEGER);`);
  return db;
}
const H = 3600_000;
function ins(db, id, { status = "pending", ageH = 0, type = "communication", result = null, to = "e1" } = {}) {
  db.prepare("INSERT INTO emergent_tasks (id, emergent_id, task_type, task_data, status, created_at, result) VALUES (?,?,?,?,?,?,?)")
    .run(id, to, type, JSON.stringify({ from_id: "a", from_name: "A", message: "hi", message_id: `m_${id}` }), status, Date.now() - ageH * H, result);
}

beforeEach(() => { delete process.env.CONCORD_BG_TASK_TTL_H; delete process.env.CONCORD_BG_EXPIRY; process.env.CONCORD_BG_STATUS_FILE = ""; });

describe("TTL expiry", () => {
  it("expires only pending/active rows older than the TTL, records prev state, and is undoable", () => {
    const db = mkDb();
    ins(db, "old_p", { ageH: 7 }); ins(db, "old_a", { status: "active", ageH: 30, result: '{"x":1}' });
    ins(db, "new_p", { ageH: 1 }); ins(db, "old_done", { status: "completed", ageH: 50, result: '{"finalText":"ok"}' });
    ins(db, "old_dream", { ageH: 8, type: "dream" });
    G._resetGovernorForTest({ db });
    const r = G.expireStaleTasks({ db });
    assert.equal(r.expired, 3);
    const rows = Object.fromEntries(db.prepare("SELECT id, status, result FROM emergent_tasks").all().map((x) => [x.id, x]));
    assert.equal(rows.new_p.status, "pending");
    assert.equal(rows.old_done.status, "completed");
    const a = JSON.parse(rows.old_a.result);
    assert.equal(rows.old_a.status, "expired");
    assert.deepEqual([a.expired_by, a.prev_status, a.prev_result], ["bg-governor", "active", '{"x":1}']);
    assert.equal(JSON.parse(rows.old_p.result).prev_status, "pending");
    assert.equal(G.getGovernorStatus().counters.expired, 3);
    // documented undo
    db.exec(`UPDATE emergent_tasks SET status = json_extract(result,'$.prev_status'), result = json_extract(result,'$.prev_result'), completed_at = NULL
             WHERE status = 'expired' AND json_extract(result,'$.expired_by') = 'bg-governor'`);
    const back = Object.fromEntries(db.prepare("SELECT id, status, result FROM emergent_tasks").all().map((x) => [x.id, x]));
    assert.equal(back.old_p.status, "pending"); assert.equal(back.old_p.result, null);
    assert.equal(back.old_a.status, "active"); assert.equal(back.old_a.result, '{"x":1}');
  });
  it("respects the batch limit so one sweep stays small", () => {
    const db = mkDb();
    for (let i = 0; i < 30; i++) ins(db, `t${i}`, { ageH: 10 });
    G._resetGovernorForTest({ db });
    assert.equal(G.expireStaleTasks({ db, batch: 12 }).expired, 12);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emergent_tasks WHERE status='pending'").get().n, 18);
  });
  it("is on by default only in enforce mode", () => {
    process.env.CONCORD_BG_GOVERNOR = "shadow"; assert.equal(G.expiryEnabled(), false);
    process.env.CONCORD_BG_GOVERNOR = "enforce"; assert.equal(G.expiryEnabled(), true);
    process.env.CONCORD_BG_EXPIRY = "0"; assert.equal(G.expiryEnabled(), false);
    delete process.env.CONCORD_BG_GOVERNOR;
  });
  it("pending count trends down and stays bounded: expiry + enforced creation", () => {
    process.env.CONCORD_BG_GOVERNOR = "enforce";
    process.env.CONCORD_BG_MAX_PENDING = "20";
    const db = mkDb();
    for (let i = 0; i < 100; i++) ins(db, `o${i}`, { ageH: 9, to: `r${i}` });
    G._resetGovernorForTest({ db });
    const counts = [];
    for (let round = 0; round < 6; round++) {
      // creators try hard every round
      for (let j = 0; j < 10; j++) {
        const req = { kind: "communication", fromId: `c${round}_${j}`, toId: `n${round}_${j}` };
        const d = G.admitCreation(req);
        if (d.allow) { ins(db, `n${round}_${j}`, { to: req.toId }); G.noteCreated(req, d); }
      }
      G.expireStaleTasks({ db, batch: 30 });
      counts.push(db.prepare("SELECT COUNT(*) n FROM emergent_tasks WHERE status='pending'").get().n);
    }
    assert.ok(counts[0] < 100);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= Math.max(counts[i - 1], 20 + 10), `not trending down: ${counts}`);
    assert.ok(counts.at(-1) <= 30, `not bounded: ${counts}`);
    delete process.env.CONCORD_BG_GOVERNOR; delete process.env.CONCORD_BG_MAX_PENDING;
  });
});

describe("traceable task outcomes", () => {
  it("a governor deferral re-queues the task; a brain error marks it failed with the reason", async () => {
    process.env.CONCORD_BG_GOVERNOR = "enforce";
    const db = mkDb();
    ins(db, "t1", { to: "e1" });
    G._resetGovernorForTest({ db });
    const { EmergentMinorAgent } = await import("../emergent/minor-agent.js");
    const ag = new EmergentMinorAgent("e1", db, null);
    ag.identity = { id: "e1", given_name: "E1" };
    G._setBreakerForTest("open", "bg_brain_unreachable");
    const task = ag._claimNextTask();
    assert.equal(db.prepare("SELECT status FROM emergent_tasks WHERE id='t1'").get().status, "active");
    const r = await ag.executeTask(task);
    assert.match(r.deferred, /bg_governor_denied:breaker_open:bg_brain_unreachable/);
    assert.equal(db.prepare("SELECT status, started_at FROM emergent_tasks WHERE id='t1'").get().status, "pending");

    // brain error path: route a task whose result carries an error
    ag._routeTask = async () => ({ finalText: "", error: "HTTP 500" });
    await ag.executeTask(ag._claimNextTask());
    const row = db.prepare("SELECT status, result FROM emergent_tasks WHERE id='t1'").get();
    assert.equal(row.status, "failed");
    assert.equal(JSON.parse(row.result).error, "HTTP 500");
    delete process.env.CONCORD_BG_GOVERNOR;
  });
});

describe("expiry under event-loop pressure", () => {
  it("keeps draining in small chunks while the loop is pressured (was: skipped entirely)", async () => {
    process.env.CONCORD_BG_EXPIRY = "1";
    const db = mkDb();
    for (let i = 0; i < 1200; i++) ins(db, `old_${i}`, { ageH: 24 * 14 });
    G._resetGovernorForTest({ db, signals: { eventLoopPressure: true } });
    const run = await G._runExpiryForTest();
    assert.equal(run.pressured, true);
    assert.equal(run.chunk, 100);
    assert.ok(run.expired > 0 && run.expired <= 500, `expired ${run.expired}`);
    const left = db.prepare("SELECT COUNT(*) n FROM emergent_tasks WHERE status='pending'").get().n;
    assert.equal(left, 1200 - run.expired);
  });
  it("CONCORD_BG_EXPIRY_UNDER_PRESSURE=0 restores the old skip", async () => {
    process.env.CONCORD_BG_EXPIRY = "1"; process.env.CONCORD_BG_EXPIRY_UNDER_PRESSURE = "0";
    const db = mkDb();
    for (let i = 0; i < 50; i++) ins(db, `old_${i}`, { ageH: 48 });
    G._resetGovernorForTest({ db, signals: { eventLoopPressure: true } });
    await G._runExpiryForTest();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emergent_tasks WHERE status='pending'").get().n, 50);
    delete process.env.CONCORD_BG_EXPIRY_UNDER_PRESSURE;
  });
  it("unpressured sweeps keep the normal chunk size", async () => {
    process.env.CONCORD_BG_EXPIRY = "1";
    const db = mkDb();
    for (let i = 0; i < 300; i++) ins(db, `old_${i}`, { ageH: 48 });
    G._resetGovernorForTest({ db, signals: { eventLoopPressure: false } });
    const run = await G._runExpiryForTest();
    assert.equal(run.pressured, false); assert.equal(run.chunk, 250); assert.equal(run.expired, 300);
  });
});
