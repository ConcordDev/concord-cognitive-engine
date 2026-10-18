// Background governor: creation + execution admission, breaker, kill switch.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as G from "../lib/background-governor.js";

const KILL = path.join(os.tmpdir(), `bg-gov-kill-${process.pid}`);
const ENV_KEYS = ["CONCORD_BG_GOVERNOR", "CONCORD_BG_KILL_FILE", "CONCORD_BG_STATUS_FILE", "CONCORD_BG_MAX_PENDING", "BRAIN_BACKGROUND_URL"];
let saved;

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_tasks (id TEXT PRIMARY KEY, emergent_id TEXT NOT NULL, task_type TEXT NOT NULL,
    task_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', priority INTEGER NOT NULL DEFAULT 50,
    created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, result TEXT);
    CREATE TABLE emergent_communications (id TEXT PRIMARY KEY, from_emergent_id TEXT, to_emergent_id TEXT, intent TEXT,
    context TEXT, initiated_at INTEGER, status TEXT);`);
  return db;
}
function addPending(db, n, { to = "x", type = "communication" } = {}) {
  const ins = db.prepare("INSERT INTO emergent_tasks (id, emergent_id, task_type, task_data, created_at) VALUES (?,?,?,?,?)");
  for (let i = 0; i < n; i++) ins.run(`t_${Math.random().toString(36).slice(2)}`, to, type, "{}", Date.now());
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.CONCORD_BG_KILL_FILE = KILL;
  process.env.CONCORD_BG_STATUS_FILE = "";
  delete process.env.BRAIN_BACKGROUND_URL;
  try { fs.unlinkSync(KILL); } catch { /* none */ }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.unlinkSync(KILL); } catch { /* none */ }
  G.stopBackgroundGovernor();
});

describe("modes", () => {
  it("defaults to shadow: verdicts are counted but work is allowed", () => {
    delete process.env.CONCORD_BG_GOVERNOR;
    const db = mkDb(); addPending(db, 5);
    process.env.CONCORD_BG_MAX_PENDING = "3";
    G._resetGovernorForTest({ db });
    const d = G.admitCreation({ kind: "communication", fromId: "a", toId: "b" });
    assert.equal(G.governorMode(), "shadow");
    assert.equal(d.allow, true);
    assert.equal(d.wouldAllow, false);
    assert.equal(d.reason, "queue_full");
    assert.equal(G.getGovernorStatus().counters.create.shadowDenied.queue_full, 1);
  });
  it("CONCORD_BG_GOVERNOR=0 is a kill switch for creation and execution", () => {
    process.env.CONCORD_BG_GOVERNOR = "0";
    G._resetGovernorForTest({ db: mkDb() });
    assert.equal(G.admitCreation({ kind: "communication" }).allow, false);
    const e = G.admitExecution({ kind: "observe", agentId: "a" });
    assert.equal(e.allow, false); assert.equal(e.reason, "killed");
  });
  it("the kill file stops background work without a restart", () => {
    process.env.CONCORD_BG_GOVERNOR = "shadow";
    G._resetGovernorForTest({ db: mkDb() });
    assert.equal(G.admitExecution({ kind: "observe", agentId: "a" }).allow, true);
    fs.writeFileSync(KILL, "");
    assert.equal(G.admitExecution({ kind: "observe", agentId: "b" }).allow, false);
    assert.equal(G.getGovernorStatus().mode, "killed");
    fs.unlinkSync(KILL);
    assert.equal(G.admitExecution({ kind: "observe", agentId: "c" }).allow, true);
  });
  it("runtime override switches modes", () => {
    delete process.env.CONCORD_BG_GOVERNOR;
    G._resetGovernorForTest({ db: mkDb() });
    G.setGovernorMode("enforce"); assert.equal(G.governorMode(), "enforce");
    G.setGovernorMode(null); assert.equal(G.governorMode(), "shadow");
    assert.throws(() => G.setGovernorMode("bogus"));
  });
});

describe("creation admission (enforce)", () => {
  beforeEach(() => { process.env.CONCORD_BG_GOVERNOR = "enforce"; });
  it("refuses when the global queue is full", () => {
    process.env.CONCORD_BG_MAX_PENDING = "10";
    const db = mkDb(); addPending(db, 10, { type: "other" });
    G._resetGovernorForTest({ db });
    const d = G.admitCreation({ kind: "communication", fromId: "a", toId: "b" });
    assert.equal(d.allow, false); assert.equal(d.reason, "queue_full");
  });
  it("refuses when the per-kind queue is full", () => {
    const db = mkDb(); addPending(db, 50, { to: "many", type: "communication" });
    G._resetGovernorForTest({ db });
    assert.equal(G.admitCreation({ kind: "communication", fromId: "a", toId: "b" }).reason, "kind_queue_full:communication");
  });
  it("refuses a recipient that already has a backlog", () => {
    const db = mkDb(); addPending(db, 3, { to: "busy" });
    G._resetGovernorForTest({ db });
    assert.equal(G.admitCreation({ kind: "communication", fromId: "a", toId: "busy" }).reason, "recipient_backlog");
    assert.equal(G.admitCreation({ kind: "communication", fromId: "a", toId: "idle" }).allow, true);
  });
  it("caps creations per creator per hour", () => {
    G._resetGovernorForTest({ db: mkDb() });
    for (let i = 0; i < 6; i++) {
      const req = { kind: "communication", fromId: "chatty", toId: `r${i}` };
      const d = G.admitCreation(req); assert.equal(d.allow, true); G.noteCreated(req, d);
    }
    assert.equal(G.admitCreation({ kind: "communication", fromId: "chatty", toId: "r9" }).reason, "creator_rate");
  });
  it("dedupes identical tasks", () => {
    G._resetGovernorForTest({ db: mkDb() });
    const req = { kind: "communication", fromId: "a", toId: "b", dedupeKey: "a|b|hello" };
    const d = G.admitCreation(req); G.noteCreated(req, d);
    assert.equal(G.admitCreation({ ...req, fromId: "a2" }).reason, "duplicate");
  });
  it("refuses creation while the breaker is open; wouldAdmitCreation has no side effects", () => {
    G._resetGovernorForTest({ db: mkDb() });
    G._setBreakerForTest("open", "bg_brain_unreachable");
    const pre = G.wouldAdmitCreation({ kind: "communication" });
    assert.equal(pre.allow, false); assert.equal(pre.reason, "breaker_open:bg_brain_unreachable");
    assert.equal(G.getGovernorStatus().counters.create.allowed, 0);
    assert.deepEqual(G.getGovernorStatus().counters.create.denied, {});
  });
});

describe("execution admission (enforce)", () => {
  beforeEach(() => { process.env.CONCORD_BG_GOVERNOR = "enforce"; G._resetGovernorForTest({ db: mkDb() }); });
  it("caps total and per-kind inflight", () => {
    const a = G.admitExecution({ kind: "dream", agentId: "d1" });
    assert.equal(a.allow, true);
    assert.equal(G.admitExecution({ kind: "dream", agentId: "d2" }).reason, "kind_inflight_cap:dream");
    const held = [G.admitExecution({ kind: "x", agentId: "1" }), G.admitExecution({ kind: "x", agentId: "2" }), G.admitExecution({ kind: "x", agentId: "3" })];
    assert.ok(held.every((h) => h.allow));
    assert.equal(G.admitExecution({ kind: "x", agentId: "4" }).reason, "inflight_cap");
    a.release({ ok: true }); held.forEach((h) => h.release({ ok: true }));
    assert.equal(G.getGovernorStatus().inflight.total, 0);
  });
  it("rate-limits each agent", () => {
    G.admitExecution({ kind: "observe", agentId: "same" }).release({ ok: true });
    assert.equal(G.admitExecution({ kind: "observe", agentId: "same" }).reason, "agent_rate");
  });
  it("records outcomes with a reason", () => {
    G.admitExecution({ kind: "observe", agentId: "e1" }).release({ ok: false, error: "timeout" });
    const st = G.getGovernorStatus();
    assert.equal(st.counters.outcomes.error, 1);
    assert.equal(st.counters.outcomes.errors.timeout, 1);
  });
  it("breaker: open denies, half-open admits one probe, 3 good probes close it, a bad one reopens", () => {
    G._setBreakerForTest("open", "chat_p95");
    assert.equal(G.admitExecution({ kind: "observe", agentId: "p0" }).reason, "breaker_open:chat_p95");
    G._setBreakerForTest("half_open", "chat_p95");
    for (let i = 0; i < 3; i++) {
      const p = G.admitExecution({ kind: "observe", agentId: `p${i + 1}` });
      assert.equal(p.allow, true);
      assert.equal(G.admitExecution({ kind: "observe", agentId: `q${i}` }).reason, "breaker_half_open");
      p.release({ ok: true });
    }
    assert.equal(G.getGovernorStatus().breaker.state, "closed");
    G._setBreakerForTest("half_open", "x");
    G.admitExecution({ kind: "observe", agentId: "bad" }).release({ ok: false, error: "boom" });
    assert.equal(G.getGovernorStatus().breaker.state, "open");
    assert.equal(G.getGovernorStatus().breaker.reason, "probe_failed");
  });
});

describe("breaker trips", () => {
  it("maps signals to trip reasons", () => {
    G._resetGovernorForTest({ db: mkDb() });
    assert.deepEqual(G.currentTrips(), []);
    G._setSignalsForTest({ eventLoopPressure: true, chat: { n: 5, p95: 30000 }, api: { n: 50, p95: 100 }, memLevel: 10, swapFreeMb: 100, swapTotalMb: 6000, errors: { n: 20, rate: 0.5 } });
    G._setBgProbeForTest({ configured: true, fails: 2 });
    assert.deepEqual(G.currentTrips(), ["event_loop_pressure", "chat_p95", "host_memory_pressure", "swap_exhausted", "bg_error_rate", "bg_brain_unreachable"]);
  });
  it("evaluate() opens on an unreachable background brain and half-opens after cooldown", async () => {
    process.env.BRAIN_BACKGROUND_URL = "http://127.0.0.1:9"; // closed port
    G._resetGovernorForTest({ db: mkDb() });
    await G.evaluate(); await G.evaluate();
    let st = G.getGovernorStatus();
    assert.equal(st.breaker.state, "open"); assert.equal(st.breaker.reason, "bg_brain_unreachable");
    delete process.env.BRAIN_BACKGROUND_URL;
    G._setBgProbeForTest({ configured: false, fails: 0 });
    G._setBreakerForTest("open", "bg_brain_unreachable", Date.now() - 61_000);
    await G.evaluate();
    st = G.getGovernorStatus();
    assert.equal(st.breaker.state, "half_open");
  });
  it("ignores /health and counts chat separately", () => {
    G._resetGovernorForTest({ db: mkDb() });
    G.recordHttp(5000, "/health"); G.recordHttp(9000, "/api/chat"); G.recordHttp(20, "/api/dtus");
    const done = G.chatStarted(); done(); done();
    assert.equal(G.getGovernorStatus().signals.chatActive, undefined); // signals refresh on evaluate
  });
});

describe("integration", () => {
  it("infer() denies a background caller without touching a brain (enforce + open breaker)", async () => {
    process.env.CONCORD_BG_GOVERNOR = "enforce";
    G._resetGovernorForTest({ db: mkDb() });
    G._setBreakerForTest("open", "host_memory_pressure");
    const { infer } = await import("../lib/inference/index.js");
    const r = await infer({ role: "subconscious", intent: "hi", callerId: "emergent:e1:observe", maxSteps: 1 });
    assert.equal(r.finalText, "");
    assert.equal(r.error, "bg_governor_denied:breaker_open:host_memory_pressure");
  });
  it("initiateCommunication refuses (no rows, no feed) when the governor says no", async () => {
    process.env.CONCORD_BG_GOVERNOR = "enforce";
    const db = mkDb(); addPending(db, 3, { to: "busy" });
    G._resetGovernorForTest({ db });
    const { initiateCommunication } = await import("../emergent/communication.js");
    const ex = initiateCommunication({ from: { id: "a" }, to: { id: "busy" }, intent: "hello", db });
    assert.equal(ex.status, "refused"); assert.equal(ex.refused_reason, "recipient_backlog");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emergent_communications").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emergent_tasks").get().n, 3);
  });
  it("initiateCommunication still inserts in shadow mode", async () => {
    process.env.CONCORD_BG_GOVERNOR = "shadow";
    const db = mkDb(); addPending(db, 3, { to: "busy" });
    G._resetGovernorForTest({ db });
    const { initiateCommunication } = await import("../emergent/communication.js");
    const ex = initiateCommunication({ from: { id: "a" }, to: { id: "busy" }, intent: "hello", db });
    assert.equal(ex.status, "pending");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emergent_tasks").get().n, 4);
    assert.equal(G.getGovernorStatus().counters.create.shadowDenied.recipient_backlog, 1);
  });
});
