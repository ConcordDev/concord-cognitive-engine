// server/tests/audit-export.test.js
//
// OP2 — pins `lib/audit-export.js`, the read-only bundle assembler behind
// `GET /api/admin/audit-export`. Runs against the REAL repo tree (the same
// discipline as repair-remediation's tests: exercise real primitives, not
// hand-waved stubs) so these assertions prove the module actually reads
// the committed audit/ artifacts, not a mocked filesystem.
//
// Two things this suite is deliberately NOT testing:
//   - The HTTP route itself (role gate, Content-Disposition on ?download=1)
//     — that's the same admin-telemetry role-gate shape already proven for
//     the sibling `/api/admin/repair/*` routes at
//     tests/e2e/repair-console-routes.test.js; a second full server-spawn
//     here would duplicate that proof for ~90s of extra CI time with no
//     new signal.
//   - The live count-loc path with includeLiveLoc:true — that shells out
//     and takes several seconds; exercised manually (documented in
//     docs/SELF_HOST_VERIFICATION.md), not on every test run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuditExport } from "../lib/audit-export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("audit-export — honest bundle assembly (real repo tree)", () => {
  it("returns the top-level envelope shape", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    assert.equal(bundle.ok, true);
    assert.equal(bundle.kind, "concord-audit-export");
    assert.equal(typeof bundle.version, "number");
    assert.equal(typeof bundle.generatedAt, "string");
    assert.ok(!Number.isNaN(new Date(bundle.generatedAt).getTime()));
    assert.equal(typeof bundle.honestyNote, "string");
    assert.ok(Array.isArray(bundle.staleSections));
  });

  it("never re-runs count-loc when includeLiveLoc:false — honest opt-out, not a silent skip", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    assert.equal(bundle.repo.loc.available, false);
    assert.equal(bundle.repo.loc.reason, "skipped");
  });

  it("computes repo metadata live and it matches the real tree", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    const { repo } = bundle;
    assert.equal(typeof repo.head, "string");
    assert.equal(repo.head.length, 40, "git HEAD should be a full 40-char SHA");
    assert.equal(typeof repo.headShort, "string");

    const realMigrationCount = fs
      .readdirSync(path.join(REPO_ROOT, "server", "migrations"))
      .filter((f) => /^\d+_.*\.js$/.test(f)).length;
    assert.equal(repo.migrationCount, realMigrationCount);

    const realDomainCount = fs
      .readdirSync(path.join(REPO_ROOT, "server", "domains"))
      .filter((f) => f.endsWith(".js")).length;
    assert.equal(repo.domainFileCount, realDomainCount);

    const realLensDirCount = fs
      .readdirSync(path.join(REPO_ROOT, "concord-frontend", "app", "lenses"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).length;
    assert.equal(repo.lensDirCount, realLensDirCount);
  });

  it("detectors section reads the committed BASELINE.json, never fabricates one", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    const { baseline } = bundle.sections.detectors;
    // BASELINE.json is a committed, tracked artifact in this repo — must be available.
    assert.equal(baseline.available, true);
    assert.equal(baseline.source, "audit/detectors/BASELINE.json");
    assert.equal(typeof baseline.generatedAt, "string");
    assert.equal(typeof baseline.ageHours, "number");
    assert.ok(baseline.ageHours >= 0);
    assert.equal(typeof baseline.stale, "boolean");
    assert.ok(baseline.totals && typeof baseline.totals.critical === "number");
  });

  it("macro-depth section reports both default and honest modes with their own generatedAt", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    const { macroDepth } = bundle.sections;
    for (const key of ["default", "honest"]) {
      const sec = macroDepth[key];
      assert.equal(sec.available, true, `macroDepth.${key} should be available in this repo`);
      assert.equal(typeof sec.weightedScore, "number");
      assert.ok(sec.weightedScore >= 0 && sec.weightedScore <= 1);
      assert.equal(typeof sec.generatedAt, "string");
    }
    // Honest floor must never exceed the generous/default score — if it does,
    // either the artifacts are corrupted or the grader definitions drifted.
    assert.ok(macroDepth.honest.weightedScore <= macroDepth.default.weightedScore + 1e-9);
  });

  it("ux-polish section reports both modes honestly", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    const { uxPolish } = bundle.sections;
    for (const key of ["default", "honest"]) {
      const sec = uxPolish[key];
      assert.equal(sec.available, true, `uxPolish.${key} should be available in this repo`);
      assert.equal(typeof sec.weightedScore, "number");
    }
  });

  it("doc-claims section is honestly unavailable (not fabricated) when no persisted run exists, else reports real counts", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    const sec = bundle.sections.docClaims;
    if (sec.available) {
      assert.equal(typeof sec.checked, "number");
      assert.equal(typeof sec.clean, "number");
      assert.ok(Array.isArray(sec.driftedFiles));
      assert.equal(sec.clean + sec.failed, sec.checked);
    } else {
      assert.equal(sec.reason, "not_generated");
      assert.ok(sec.note.includes("check-doc-claims-all.mjs"));
    }
  });

  it("every section exposes a `reproduce` command string — never a dead-end result", async () => {
    const bundle = await buildAuditExport({ includeLiveLoc: false });
    for (const [name, sec] of Object.entries(bundle.sections)) {
      assert.equal(typeof sec.reproduce, "string", `${name}.reproduce should be a string`);
      assert.ok(sec.reproduce.length > 0);
    }
  });
});
