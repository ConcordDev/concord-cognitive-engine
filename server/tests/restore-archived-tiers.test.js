import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { initDTUStore } from "../lib/dtu-store.js";
import { up as archiveUp } from "../migrations/401_dtu_store_archive.js";
import { packDtuData } from "../lib/dtu-at-rest.js";
import {
  restoreArchivedTiers,
  formatRestoreReport,
} from "../scripts/restore-archived-tiers.mjs";

const dbPath = path.join(os.tmpdir(), `restore-archived-tiers-${process.pid}.db`);

function seed(db) {
  initDTUStore(db);
  archiveUp(db);
  const now = "2026-08-26T00:00:00.000Z";
  const live = db.prepare(`
    INSERT INTO dtu_store (id, title, tier, scope, tags, source, created_at, updated_at, data)
    VALUES (?, ?, ?, 'global', ?, 'system', ?, ?, ?)
  `);
  const archived = db.prepare(`
    INSERT INTO dtu_store_archive
      (id, title, tier, scope, tags, source, created_at, updated_at, archived_at, archive_reason, data)
    VALUES (?, ?, ?, 'global', '[]', 'system', ?, ?, ?, 'cold_age', ?)
  `);

  const megaPayload = { id: "arch-mega", title: "MEGA — harbor", tier: "mega", tags: ["harbor", "tier_downgraded"] };
  archived.run("arch-mega", "MEGA — harbor", "mega", now, now, now, packDtuData(JSON.stringify(megaPayload)));

  const hyperPayload = { id: "arch-hyper", title: "HYPER — coast", tier: "hyper", tags: ["coast"] };
  archived.run("arch-hyper", "HYPER — coast", "regular", now, now, now, JSON.stringify(hyperPayload));

  const already = { id: "already-mega", title: "MEGA — kept", tier: "mega", tags: ["kept"] };
  live.run("already-mega", "MEGA — kept", "mega", "[]", now, now, JSON.stringify(already));
  archived.run("already-mega", "MEGA — kept", "mega", now, now, now, JSON.stringify(already));

  live.run(
    "down-mega",
    "MEGA — downgraded harbor",
    "regular",
    JSON.stringify(["tier_downgraded", "harbor"]),
    now,
    now,
    JSON.stringify({ id: "down-mega", title: "MEGA — downgraded harbor", tier: "regular", tags: ["tier_downgraded", "harbor"] }),
  );
  live.run(
    "down-hyper",
    "HYPER — downgraded coast",
    "regular",
    JSON.stringify(["tier_downgraded"]),
    now,
    now,
    JSON.stringify({ id: "down-hyper", title: "HYPER — downgraded coast", tier: "regular", tags: ["tier_downgraded"] }),
  );
  live.run(
    "plain",
    "a regular note",
    "regular",
    "[]",
    now,
    now,
    JSON.stringify({ id: "plain", title: "a regular note", tier: "regular", tags: [] }),
  );
  live.run(
    "decoy-title",
    "MEGA — not downgraded",
    "regular",
    "[]",
    now,
    now,
    JSON.stringify({ id: "decoy-title", title: "MEGA — not downgraded", tier: "regular", tags: [] }),
  );
}

describe("restore-archived-tiers", () => {
  after(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
    }
  });

  it("dry-run prints counts and writes nothing; apply is idempotent", () => {
    const db = new Database(dbPath);
    seed(db);

    const dry = restoreArchivedTiers(db, { apply: false });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.archiveMega, 1);
    assert.equal(dry.archiveHyper, 1);
    assert.equal(dry.downgradedMega, 1);
    assert.equal(dry.downgradedHyper, 1);
    assert.equal(dry.alreadyLive, 1);
    assert.equal(dry.restored, 0);
    assert.equal(dry.retiered, 0);
    const report = formatRestoreReport(dry);
    assert.match(report, /restore-archived-tiers: dry-run/);
    assert.match(report, /archive_mega: 1/);
    assert.match(report, /archive_hyper: 1/);
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'down-mega'`).get().tier, "regular");
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM dtu_store_archive`).get().n, 3);

    const applied = restoreArchivedTiers(db, { apply: true });
    assert.equal(applied.dryRun, false);
    assert.equal(applied.restored, 2);
    assert.equal(applied.retiered, 2);

    const mega = db.prepare(`SELECT tier, tags, data FROM dtu_store WHERE id = 'arch-mega'`).get();
    assert.equal(mega.tier, "mega");
    assert.equal(JSON.parse(mega.tags).includes("tier_downgraded"), false);
    assert.equal(JSON.parse(mega.data).tier, "mega");
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'arch-hyper'`).get().tier, "hyper");
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'down-mega'`).get().tier, "mega");
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'down-hyper'`).get().tier, "hyper");
    assert.equal(JSON.parse(db.prepare(`SELECT tags FROM dtu_store WHERE id = 'down-mega'`).get().tags).includes("tier_downgraded"), false);
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'already-mega'`).get().tier, "mega");
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'plain'`).get().tier, "regular");
    assert.equal(db.prepare(`SELECT tier FROM dtu_store WHERE id = 'decoy-title'`).get().tier, "regular");
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM dtu_store_archive`).get().n, 0);

    const again = restoreArchivedTiers(db, { apply: true });
    assert.equal(again.archiveMega, 0);
    assert.equal(again.archiveHyper, 0);
    assert.equal(again.downgradedMega, 0);
    assert.equal(again.downgradedHyper, 0);
    assert.equal(again.restored, 0);
    assert.equal(again.retiered, 0);
    db.close();
  });

  it("the CLI dry-run prints the report and does not require --apply", () => {
    const cliDb = path.join(os.tmpdir(), `restore-archived-tiers-cli-${process.pid}.db`);
    const db = new Database(cliDb);
    seed(db);
    db.close();
    const script = path.join(import.meta.dirname, "../scripts/restore-archived-tiers.mjs");
    const run = spawnSync(process.execPath, [script, "--db", cliDb], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /restore-archived-tiers: dry-run/);
    assert.match(run.stdout, /archive_mega: 1/);
    assert.match(run.stdout, /downgraded_mega: 1/);
    const check = new Database(cliDb);
    assert.equal(check.prepare(`SELECT tier FROM dtu_store WHERE id = 'down-mega'`).get().tier, "regular");
    assert.equal(check.prepare(`SELECT COUNT(*) AS n FROM dtu_store_archive`).get().n, 3);
    check.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(cliDb + suffix); } catch { /* already gone */ }
    }
  });
});
