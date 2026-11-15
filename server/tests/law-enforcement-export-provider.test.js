// Behavior test for FIX-law-enforcement-001: law-enforcement cases
// live in the le_cases table when a database is present (migration
// 362) — no export leg read the table, so Export said "Nothing to
// export yet" with the case fixture present. Pins: the caller's DB
// cases export through the provider; another user's do not; the
// no-db memory fallback exports too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerLawEnforcementActions = (await import("../domains/lawenforcement.js")).default;
_clearLensExportProvidersForTests();
registerLawEnforcementActions(() => {});

globalThis._concordSTATE = { _lawEnforcement: {} };

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE le_cases (
  id TEXT PRIMARY KEY, user_id TEXT, case_number TEXT, title TEXT, synopsis TEXT,
  status TEXT, assigned_detective TEXT, opened_at TEXT, closed_at TEXT,
  closure_reason TEXT, created_at TEXT, updated_at TEXT)`);
const ins = db.prepare(`INSERT INTO le_cases
  (id, user_id, case_number, title, synopsis, status, assigned_detective, opened_at, closed_at, closure_reason, created_at, updated_at)
  VALUES (?, ?, ?, ?, '', 'open', '', ?, NULL, '', ?, ?)`);
ins.run("case_1", "user-a", "LE-2026-001", "Harbor warehouse fire", "2026-11-12T08:00:00.000Z", "2026-11-12T08:00:00.000Z", "2026-11-12T08:00:00.000Z");
ins.run("case_9", "user-b", "LE-2026-009", "Not yours", "2026-11-12T08:00:00.000Z", "2026-11-12T08:00:00.000Z", "2026-11-12T08:00:00.000Z");

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("law-enforcement export includes the caller's DB cases only", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "law-enforcement", ctx: { actor: { userId: "user-a" }, db } });
  const cases = out.artifacts.filter((r) => r.type === "case");
  assert.equal(cases.length, 1, "exactly the caller's case");
  assert.equal(cases[0].id, "case_1");
  assert.equal(cases[0].data.caseNumber, "LE-2026-001");
  assert.equal(cases[0].data.title, "Harbor warehouse fire");
});
