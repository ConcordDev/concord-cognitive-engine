// Bidirectional pin for the stale-code detector's rebuild-staging exemption.
//
// Context: the `table_orphan` rule flags tables created but never referenced
// outside migrations. It only scans NON-migration files for references, so a
// staging table used entirely within its own migration is invisible to it and
// looks orphaned. The rule already exempted migration 107's `_fix` convention;
// on 2026-07-25 that was generalised (authorized detector edit) to also cover
// the `_new`/`_old` CHECK-widening rebuild convention used by migrations 372
// and 379 — SQLite cannot ALTER a CHECK, so those create `<base>_new`, copy,
// drop `<base>`, and rename back.
//
// This file pins BOTH directions, because an exemption that only proves
// "the finding went away" is indistinguishable from having blunted the rule:
//   direction 1 — the three real staging tables no longer flag
//   direction 2 — the rule STILL flags a genuinely orphaned table, including
//                 one that merely ends in a staging suffix without ever being
//                 renamed or dropped in its own migration
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { runStaleCodeDetector } from "../lib/detectors/stale-code-detector.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

test("direction 1: real _new/_old rebuild-staging tables no longer flag as orphans", async () => {
  const r = await runStaleCodeDetector({ root: REPO });
  const orphans = r.findings.filter(f => f.id === "table_orphan");
  const flagged = new Set(orphans.map(f => f.evidence?.table));

  // These three are the exact findings the generalisation was made for. Each
  // is created and renamed back to its base name inside its own migration:
  //   372: ALTER TABLE economy_ledger_new RENAME TO economy_ledger
  //   379: ALTER TABLE agent_marathon_sessions_new RENAME TO ..._sessions
  //   379: ALTER TABLE agent_marathon_sessions_old RENAME TO ..._sessions
  for (const t of ["economy_ledger_new", "agent_marathon_sessions_new", "agent_marathon_sessions_old"]) {
    assert.equal(flagged.has(t), false, `${t} is rebuild staging and must not be flagged as an orphan`);
  }
});

test("direction 2: the rule STILL catches a genuine orphan (exemption did not blunt it)", async () => {
  // Build a throwaway tree shaped like the real one, containing:
  //  (a) a table with NO staging suffix, referenced nowhere -> must flag
  //  (b) a table ending in `_new` that is NEVER renamed/dropped in its own
  //      migration -> must STILL flag, proving the suffix alone is not a pass
  //  (c) a proper `_new` staging table renamed back in-file -> must not flag
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stale-code-bidir-"));
  try {
    const migrations = path.join(dir, "server", "migrations");
    fs.mkdirSync(migrations, { recursive: true });
    fs.mkdirSync(path.join(dir, "server", "lib"), { recursive: true });

    fs.writeFileSync(path.join(migrations, "900_genuine_orphan.js"), `
      export function up(db) {
        db.exec(\`CREATE TABLE truly_orphaned_widgets (id TEXT PRIMARY KEY);\`);
      }
    `);
    fs.writeFileSync(path.join(migrations, "901_suffix_without_rename.js"), `
      export function up(db) {
        db.exec(\`CREATE TABLE pretend_staging_new (id TEXT PRIMARY KEY);\`);
      }
    `);
    fs.writeFileSync(path.join(migrations, "902_real_staging.js"), `
      export function up(db) {
        db.exec(\`CREATE TABLE real_thing_new (id TEXT PRIMARY KEY);\`);
        db.exec(\`INSERT INTO real_thing_new SELECT * FROM real_thing;\`);
        db.exec(\`DROP TABLE real_thing;\`);
        db.exec(\`ALTER TABLE real_thing_new RENAME TO real_thing;\`);
      }
    `);

    const r = await runStaleCodeDetector({ root: dir });
    const flagged = new Set(
      r.findings.filter(f => f.id === "table_orphan").map(f => f.evidence?.table),
    );

    assert.equal(flagged.has("truly_orphaned_widgets"), true,
      "a plain unreferenced table must still be flagged — the rule is not blunted");
    assert.equal(flagged.has("pretend_staging_new"), true,
      "a _new suffix WITHOUT an in-file rename/drop must still be flagged — " +
      "the exemption requires the rename-or-drop proof, not just the suffix");
    assert.equal(flagged.has("real_thing_new"), false,
      "a genuine rebuild-staging table renamed back in-file must be exempt");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
