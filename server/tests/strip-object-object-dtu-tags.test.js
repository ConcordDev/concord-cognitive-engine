// Cleanup script: dry-run lists DTUs carrying the coercion tag, and
// --apply removes only that tag. Runs against a temp SQLite file.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "strip-object-object-dtu-tags.mjs",
);
const dir = mkdtempSync(path.join(tmpdir(), "object-tag-"));
const dbPath = path.join(dir, "dtus.db");

function open() {
  return new Database(dbPath);
}

function seed() {
  const db = open();
  db.exec(`
    CREATE TABLE dtu_store (
      id TEXT PRIMARY KEY,
      title TEXT,
      tags TEXT,
      data TEXT NOT NULL,
      source TEXT,
      updated_at TEXT
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT,
      tags_json TEXT NOT NULL,
      body_json TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  const store = db.prepare(
    "INSERT INTO dtu_store (id, title, tags, data, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  store.run(
    "feed_lower",
    "Lower case",
    JSON.stringify(["[object object]", "markets", "[object Object]"]),
    JSON.stringify({
      id: "feed_lower",
      title: "Lower case",
      tags: ["[object object]", "markets"],
      note: "leave-me",
      source: "feed",
    }),
    "feed",
    "2026-01-01T00:00:00.000Z",
  );
  store.run(
    "feed_data_only",
    "Data only",
    JSON.stringify(["real"]),
    JSON.stringify({
      id: "feed_data_only",
      title: "Data only",
      tags: ["[OBJECT OBJECT]", "kept"],
      score: 3,
    }),
    "feed",
    "2026-01-02T00:00:00.000Z",
  );
  store.run(
    "clean",
    "Clean",
    JSON.stringify(["science"]),
    JSON.stringify({ id: "clean", title: "Clean", tags: ["science"], note: "untouched" }),
    "user",
    "2026-01-03T00:00:00.000Z",
  );
  db.prepare(
    "INSERT INTO dtus (id, title, tags_json, body_json, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "legacy_1",
    "Legacy",
    JSON.stringify(["[object object]", "legacy-keep"]),
    JSON.stringify({ body: "do not rewrite", tags: ["not-this-column"] }),
    "2026-01-04T00:00:00.000Z",
  );
  db.close();
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function jsonLine(stdout) {
  const line = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  return JSON.parse(line);
}

describe("strip-object-object-dtu-tags script", () => {
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("dry-run lists the DTUs and writes nothing", () => {
    seed();
    const before = readFileSync(dbPath);
    const dry = run([dbPath]);
    assert.equal(dry.status, 0, dry.stderr);
    const summary = jsonLine(dry.stdout);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.count, 3);
    assert.equal(summary.applied, 0);
    assert.match(dry.stdout, /feed_lower/);
    assert.match(dry.stdout, /feed_data_only/);
    assert.match(dry.stdout, /legacy_1/);
    assert.doesNotMatch(dry.stdout, /\bclean\b/);
    assert.deepEqual(readFileSync(dbPath), before);

    const db = open();
    const row = db.prepare("SELECT tags, data, updated_at, source FROM dtu_store WHERE id = ?").get("feed_lower");
    assert.ok(JSON.parse(row.tags).includes("[object object]"));
    assert.equal(row.updated_at, "2026-01-01T00:00:00.000Z");
    assert.equal(row.source, "feed");
    db.close();
  });

  it("--apply removes only the coercion tag and leaves every other field", () => {
    const applied = run([dbPath, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    const summary = jsonLine(applied.stdout);
    assert.equal(summary.dryRun, false);
    assert.equal(summary.count, 3);
    assert.equal(summary.applied, 3);

    const db = open();
    const lower = db.prepare("SELECT * FROM dtu_store WHERE id = ?").get("feed_lower");
    assert.deepEqual(JSON.parse(lower.tags), ["markets"]);
    const lowerData = JSON.parse(lower.data);
    assert.deepEqual(lowerData.tags, ["markets"]);
    assert.equal(lowerData.note, "leave-me");
    assert.equal(lowerData.source, "feed");
    assert.equal(lowerData.title, "Lower case");
    assert.equal(lower.title, "Lower case");
    assert.equal(lower.source, "feed");
    assert.equal(lower.updated_at, "2026-01-01T00:00:00.000Z");

    const dataOnly = db.prepare("SELECT * FROM dtu_store WHERE id = ?").get("feed_data_only");
    assert.deepEqual(JSON.parse(dataOnly.tags), ["real"]);
    const dataOnlyBody = JSON.parse(dataOnly.data);
    assert.deepEqual(dataOnlyBody.tags, ["kept"]);
    assert.equal(dataOnlyBody.score, 3);
    assert.equal(dataOnly.updated_at, "2026-01-02T00:00:00.000Z");

    const clean = db.prepare("SELECT * FROM dtu_store WHERE id = ?").get("clean");
    assert.deepEqual(JSON.parse(clean.tags), ["science"]);
    assert.equal(JSON.parse(clean.data).note, "untouched");
    assert.equal(clean.updated_at, "2026-01-03T00:00:00.000Z");
    assert.equal(clean.source, "user");

    const legacy = db.prepare("SELECT * FROM dtus WHERE id = ?").get("legacy_1");
    assert.deepEqual(JSON.parse(legacy.tags_json), ["legacy-keep"]);
    assert.equal(JSON.parse(legacy.body_json).body, "do not rewrite");
    assert.deepEqual(JSON.parse(legacy.body_json).tags, ["not-this-column"]);
    assert.equal(legacy.updated_at, "2026-01-04T00:00:00.000Z");
    db.close();
  });

  it("a second --apply finds nothing", () => {
    const again = run([dbPath, "--apply"]);
    assert.equal(again.status, 0, again.stderr);
    const summary = jsonLine(again.stdout);
    assert.equal(summary.count, 0);
    assert.equal(summary.applied, 0);
  });

  it("refuses a missing database path", () => {
    const missing = run([path.join(dir, "nope.db"), "--apply"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /database not found/);
    assert.equal(existsSync(path.join(dir, "nope.db")), false);
    const noArgs = run([]);
    assert.equal(noArgs.status, 2);
    assert.match(noArgs.stderr, /usage:/);
  });
});
