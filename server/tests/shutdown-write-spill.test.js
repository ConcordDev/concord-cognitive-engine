// Reproduces the 2026-10-27 15:03 ET write loss: a DTU commit fanning out
// into lens-artifact saves ~700 ms AFTER shutdown closed the DB. Before the
// fix each save threw "The database connection is not open" and was lost.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";
import { sealDatabaseWrites } from "../lib/shutdown-http.js";
import {
  configureWriteSpill, replaySpill, spilledIsNewer, waitForWriteQuiet, noteDbWrite, spillStats,
} from "../lib/shutdown-write-gate.js";

let Database;
before(async () => { Database = (await import("better-sqlite3")).default; });

let dir, spillPath, logs;
const log = (level, event, data) => { logs.push({ level, event, data }); };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spill-"));
  spillPath = path.join(dir, "shutdown-write-spill.jsonl");
  logs = [];
  configureWriteSpill({ spillPath, log });
});
const artifact = (id, over = {}) => ({ id, domain: "code", type: "snippet", ownerId: "u1", title: `art ${id}`, data: { body: "x" }, updatedAt: "2026-10-27T19:03:09.629Z", ...over });

describe("pending lens-artifact save during shutdown", () => {
  it("a save after seal+close is spilled, not failed, and replays on next boot", () => {
    const db = new Database(":memory:");
    createTable(db);
    const store = new LensArtifactStore(db, { log });
    store.set("a0", artifact("a0")); // warm prepared statements like prod
    // Shutdown: seal then close (server.js shutdown callback order).
    sealDatabaseWrites(db);
    db.close();
    // The in-flight DTU commit now mirrors into lens artifacts.
    for (let i = 1; i <= 11; i++) store.set(`a${i}`, artifact(`a${i}`));
    assert.equal(logs.filter((l) => l.event === "lens_artifact_persist_failed").length, 0);
    assert.equal(logs.filter((l) => l.event === "shutdown_write_spilled").length, 11);
    const lines = fs.readFileSync(spillPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 11);

    // Next boot: fresh DB (file reopened), replay through the store's set().
    const db2 = new Database(":memory:");
    createTable(db2);
    const store2 = new LensArtifactStore(db2, { log });
    const r = replaySpill({
      spillPath,
      apply: (kind, id, payload) => {
        if (kind !== "lens_artifact" || !spilledIsNewer(store2.get(id), payload)) return "skipped";
        store2.set(id, payload); return "applied";
      },
      log,
    });
    assert.equal(r.replayed, 11);
    assert.equal(db2.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 11);
    assert.equal(fs.existsSync(spillPath), false, "spill renamed so it replays once");
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes(".replayed-")).length, 1);
  });

  it("an error path that hits a closed handle mid-call is spilled too", () => {
    const db = new Database(":memory:");
    createTable(db);
    const store = new LensArtifactStore(db, { log });
    store.set("a0", artifact("a0"));
    // Simulate the race where db.open still reads true but the run throws.
    const s = store._statements();
    s.upsert = { run() { throw new Error("The database connection is not open"); } };
    store.set("a1", artifact("a1"));
    assert.equal(logs.filter((l) => l.event === "lens_artifact_persist_failed").length, 0);
    assert.equal(fs.readFileSync(spillPath, "utf8").trim().split("\n").length, 1);
  });

  it("dtu-store writes after close are spilled", () => {
    const db = new Database(":memory:");
    initDTUStore(db);
    const store = createDTUStore(db, new Map(), { log });
    store.set("dtu_x", { id: "dtu_x", title: "x", tier: "regular", createdAt: "2026-10-27T19:00:00Z", updatedAt: "2026-10-27T19:00:00Z" });
    db.close();
    store.set("dtu_y", { id: "dtu_y", title: "y", tier: "regular", createdAt: "2026-10-27T19:03:09Z", updatedAt: "2026-10-27T19:03:09Z" });
    assert.equal(logs.filter((l) => l.event === "dtu_store_persist_failed").length, 0);
    const e = JSON.parse(fs.readFileSync(spillPath, "utf8").trim());
    assert.equal(e.kind, "dtu");
    assert.equal(e.id, "dtu_y");
  });

  it("replay never overwrites a newer row", () => {
    assert.equal(spilledIsNewer({ updatedAt: "2026-10-27T20:00:00Z" }, { updatedAt: "2026-10-27T19:00:00Z" }), false);
    assert.equal(spilledIsNewer(undefined, { updatedAt: "x" }), true);
  });

  it("a spill that cannot be written is logged as dropped", () => {
    configureWriteSpill({ spillPath: path.join(dir, "f"), log });
    fs.writeFileSync(path.join(dir, "f"), "");
    configureWriteSpill({ spillPath: path.join(dir, "f", "nested.jsonl"), log });
    const db = new Database(":memory:"); createTable(db);
    const store = new LensArtifactStore(db, { log });
    db.close();
    const before = spillStats().dropped;
    store.set("z", artifact("z"));
    assert.equal(spillStats().dropped, before + 1);
    assert.equal(logs.filter((l) => l.event === "shutdown_write_dropped").length, 1);
  });
});

describe("waitForWriteQuiet (bounded drain before close)", () => {
  it("returns at once when idle, waits while writes continue, stops at budget", async () => {
    let t = 100000;
    const now = () => t;
    const sleep = async (ms) => { t += ms; };
    noteDbWrite(t - 1000);
    assert.deepEqual(await waitForWriteQuiet({ quietMs: 400, budgetMs: 1500, now, sleep }), { waitedMs: 0, quiet: true });
    noteDbWrite(t);
    const r = await waitForWriteQuiet({ quietMs: 400, budgetMs: 1500, now, sleep });
    assert.equal(r.quiet, true); assert.equal(r.waitedMs, 400);
    // Writes keep landing: budget caps the wait.
    noteDbWrite(t);
    const busySleep = async (ms) => { t += ms; noteDbWrite(t); };
    const b = await waitForWriteQuiet({ quietMs: 400, budgetMs: 1500, now, sleep: busySleep });
    assert.equal(b.quiet, false); assert.ok(b.waitedMs >= 1500 && b.waitedMs < 1600);
  });
});
