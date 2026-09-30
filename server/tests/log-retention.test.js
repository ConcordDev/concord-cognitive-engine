import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { pruneLog, RETAINED_LOGS } from "../lib/log-retention.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-28T12:00:00Z");

function setup() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_activity_feed (id TEXT PRIMARY KEY, emergent_id TEXT, event_type TEXT NOT NULL, event_data TEXT NOT NULL, created_at INTEGER NOT NULL);
           CREATE TABLE inference_spans (id INTEGER PRIMARY KEY AUTOINCREMENT, inference_id TEXT NOT NULL, span_type TEXT NOT NULL, recorded_at TEXT NOT NULL);
           CREATE TABLE brain_interactions (id TEXT PRIMARY KEY, brain_id TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'pending', train_consented INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "log-retention-"));
  return { db, root };
}

const spec = (t) => RETAINED_LOGS.find((s) => s.table === t);

test("archives then deletes only rows past the window (ms timestamps)", async (t) => {
  const { db, root } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ins = db.prepare("INSERT INTO emergent_activity_feed VALUES (?, 'e1', 'dream', '{}', ?)");
  for (let i = 0; i < 7; i++) ins.run(`old${i}`, NOW - 20 * DAY + i);
  for (let i = 0; i < 3; i++) ins.run(`new${i}`, NOW - 2 * DAY + i);

  const r = await pruneLog(db, spec("emergent_activity_feed"), { days: 14, now: NOW, archiveRoot: root, batchSize: 3 });
  assert.deepEqual({ ok: r.ok, archived: r.archived, deleted: r.deleted, done: r.done }, { ok: true, archived: 7, deleted: 7, done: true });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM emergent_activity_feed").get().c, 3);

  const day = new Date(NOW - 20 * DAY).toISOString().slice(0, 10);
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(root, "emergent_activity_feed", `${day}.jsonl.gz`))).toString().trim().split("\n");
  assert.equal(lines.length, 7);
  assert.equal(JSON.parse(lines[0]).id, "old0");
});

test("text timestamps (both datetime() and ISO forms) and the per-call cap", async (t) => {
  const { db, root } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ins = db.prepare("INSERT INTO inference_spans (inference_id, span_type, recorded_at) VALUES ('i', 's', ?)");
  for (let i = 0; i < 4; i++) ins.run("2026-09-01 10:00:00");
  for (let i = 0; i < 4; i++) ins.run("2026-09-02T10:00:00.000Z");
  ins.run("2026-09-27T10:00:00.000Z");

  const first = await pruneLog(db, spec("inference_spans"), { days: 14, now: NOW, archiveRoot: root, batchSize: 3, maxBatches: 2 });
  assert.equal(first.deleted, 6);
  assert.equal(first.done, false);
  const second = await pruneLog(db, spec("inference_spans"), { days: 14, now: NOW, archiveRoot: root, batchSize: 3, maxBatches: 2 });
  assert.equal(second.deleted, 2);
  assert.equal(second.done, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM inference_spans").get().c, 1);
});

test("returns an honest failure instead of throwing on a missing table", async () => {
  const db = new Database(":memory:");
  const r = await pruneLog(db, spec("inference_spans"), { days: 14, now: NOW, archiveRoot: os.tmpdir() });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no such table/);
});

test("brain_interactions: prunes settled non-training rows only — never pending or positive", async (t) => {
  const { db, root } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = Math.floor((NOW - 10 * DAY) / 1000);
  const recent = Math.floor((NOW - 2 * DAY) / 1000);
  const ins = db.prepare("INSERT INTO brain_interactions (id, brain_id, outcome, created_at) VALUES (?, 'subconscious', ?, ?)");
  ins.run("old-stuck", "stuck_timeout", old);
  ins.run("old-expired", "expired", old);
  ins.run("old-pending", "pending", old);
  ins.run("old-positive", "positive", old);
  ins.run("new-stuck", "stuck_timeout", recent);

  const r = await pruneLog(db, spec("brain_interactions"), { now: NOW, archiveRoot: root });
  assert.equal(r.deleted, 2);
  const left = db.prepare("SELECT id FROM brain_interactions ORDER BY id").all().map((x) => x.id);
  assert.deepEqual(left, ["new-stuck", "old-pending", "old-positive"]);

  const day = new Date(old * 1000).toISOString().slice(0, 10);
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(root, "brain_interactions", `${day}.jsonl.gz`))).toString().trim().split("\n");
  assert.deepEqual(lines.map((l) => JSON.parse(l).id).sort(), ["old-expired", "old-stuck"]);
});
