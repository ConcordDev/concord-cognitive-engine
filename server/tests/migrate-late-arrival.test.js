// A migration numbered below already-applied ones (e.g. 467 merged after
// 468/469 ran) must still be applied, not skipped because MAX(version) is
// higher. Runs migrate.js against an isolated temp migrations directory.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-mig-late-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name, table) => fs.writeFileSync(path.join(dir, name),
  `export function up(db) { db.exec("CREATE TABLE IF NOT EXISTS ${table} (id INTEGER)"); }\nexport function down(db) { db.exec("DROP TABLE IF EXISTS ${table}"); }\n`);

describe("migrate.js — late-arriving lower-numbered migration", () => {
  it("applies 467 after 468/469 have already run", async () => {
    process.env.CONCORD_MIGRATIONS_DIR = dir;
    const { runMigrations } = await import(`../migrate.js?late=${Date.now()}`);
    const db = new Database(":memory:");
    write("468_b.js", "t468");
    write("469_c.js", "t469");
    const first = await runMigrations(db);
    assert.equal(first.appliedCount, 2);

    write("467_a.js", "t467");
    const second = await runMigrations(db);
    assert.equal(second.appliedCount, 1, "the late 467 is applied, not skipped");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes("t467"));
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all().map((r) => r.version);
    assert.deepEqual(versions, [467, 468, 469]);

    const third = await runMigrations(db);
    assert.equal(third.appliedCount, 0, "nothing re-applies");
    delete process.env.CONCORD_MIGRATIONS_DIR;
  });
});
