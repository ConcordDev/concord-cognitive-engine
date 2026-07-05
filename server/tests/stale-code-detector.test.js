// server/tests/stale-code-detector.test.js
//
// Unit B4 — pins a bidirectional fix to the stale-code detector's orphan-table
// scan (`server/lib/detectors/stale-code-detector.js`, section 2, "Orphan
// tables"). The false positive: `TABLE_DDL_RE` ran over RAW migration text
// (including comments), and `server/migrations/275_evo_asset_fk_repair.js:35`
// contains the prose "...its CREATE TABLE omitted the column..." — the regex
// greedily captured "omitted" as a table name, which trivially has no
// references anywhere, producing a phantom `table_orphan` finding.
//
// The fix strips JS comments (reusing `stripComments` from the
// command-injection detector) before running TABLE_DDL_RE / TABLE_REF_RE /
// TABLE_DROP_RE, scoped to ONLY the orphan-table section.
//
// This test proves BOTH directions:
//   (a) prose that merely LOOKS like a CREATE TABLE inside a comment is no
//       longer flagged (the false positive is gone), and
//   (b) a genuine CREATE TABLE with zero consumers is STILL flagged (the
//       detector hasn't been softened / blinded).
//   (c) the real migration 275 file, which triggered this bug report,
//       produces no `table_orphan` finding for "omitted".
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { runStaleCodeDetector } from "../lib/detectors/stale-code-detector.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("stale-code detector — orphan-table comment false-positive (Unit B4)", () => {
  let tmpRoot;

  before(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "stale-code-b4-"));
    const migrationsDir = path.join(tmpRoot, "server", "migrations");
    await mkdir(migrationsDir, { recursive: true });

    // (a) A migration whose COMMENT contains prose that reads exactly like a
    // CREATE TABLE statement ("CREATE TABLE ghost_prose") immediately
    // followed by a real, genuinely-referenced table. Reproduces the
    // migration-275 shape: real DDL + narrative comment in the same file.
    await writeFile(
      path.join(migrationsDir, "001_prose_only.js"),
      [
        "// Historical note: migration 202's rebuild dropped it (its CREATE",
        "// TABLE ghost_prose omitted the column). Restored below.",
        "export function up(db) {",
        "  db.exec(`CREATE TABLE real_table_a (id TEXT PRIMARY KEY)`);",
        "}",
        "export function down() {}",
        "",
      ].join("\n"),
    );

    // (b) A migration with a REAL, genuinely-orphaned table (no comment
    // involved at all) that no other file references — must still be caught.
    await writeFile(
      path.join(migrationsDir, "002_real_orphan.js"),
      [
        "export function up(db) {",
        "  db.exec(`CREATE TABLE real_orphan_xyz (id TEXT PRIMARY KEY)`);",
        "}",
        "export function down() {}",
        "",
      ].join("\n"),
    );

    // A non-migration server file that references real_table_a (so it is
    // NOT an orphan) — exercises the TABLE_REF_RE side of the same fix.
    const libDir = path.join(tmpRoot, "server", "lib");
    await mkdir(libDir, { recursive: true });
    await writeFile(
      path.join(libDir, "reader.js"),
      "export function readIt(db) { return db.prepare('SELECT * FROM real_table_a').all(); }\n",
    );
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("(a) does not flag a table name that only appears inside a comment", async () => {
    const report = await runStaleCodeDetector({ root: tmpRoot });
    assert.equal(report.ok, true);
    const ghostFinding = report.findings.find(
      (f) => f.id === "table_orphan" && f.evidence?.table === "ghost_prose",
    );
    assert.equal(
      ghostFinding,
      undefined,
      "prose 'CREATE TABLE ghost_prose' living inside a // comment must not be flagged as an orphan table",
    );
    // The real table declared in the same file (outside the comment) is
    // referenced elsewhere, so it correctly produces no orphan finding
    // either — but for a DIFFERENT reason (it has a real consumer).
    const realTableFinding = report.findings.find(
      (f) => f.id === "table_orphan" && f.evidence?.table === "real_table_a",
    );
    assert.equal(realTableFinding, undefined, "real_table_a has a real consumer and must not be flagged");
  });

  it("(b) still flags a genuine orphan table with a real CREATE TABLE and zero consumers", async () => {
    const report = await runStaleCodeDetector({ root: tmpRoot });
    const orphan = report.findings.find(
      (f) => f.id === "table_orphan" && f.evidence?.table === "real_orphan_xyz",
    );
    assert.ok(orphan, "genuine orphan table real_orphan_xyz must still be flagged — detection must not be softened");
    assert.equal(orphan.severity, "medium");
    assert.equal(orphan.id, "table_orphan");
  });

  it("(c) the real migrations/275_evo_asset_fk_repair.js produces no table_orphan finding for 'omitted'", { timeout: 60_000 }, async () => {
    const report = await runStaleCodeDetector({ root: ROOT });
    assert.equal(report.ok, true);
    const falsePositive = report.findings.find(
      (f) => f.id === "table_orphan" && f.evidence?.table === "omitted",
    );
    assert.equal(
      falsePositive,
      undefined,
      "comment prose '...CREATE TABLE omitted the...' in migration 275 must not produce a table_orphan finding",
    );
  });
});
