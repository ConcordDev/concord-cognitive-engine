// FIX-careers-002: the careers export must contain the lens's own
// careers data for the caller — their contracts (career_contracts)
// and their per-track ladder/shift standing (player_career_progress)
// — and nothing site-wide. Both stores sit behind the careers.*
// macros, invisible to the generic export legs; careers.js registers
// a lens export provider over them. Hermetic: in-memory node:sqlite
// with the migrations' own shapes (312 + 469).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerCareerMacros = (await import("../domains/careers.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("careers export provider (FIX-careers-002)", () => {
  let db;
  before(() => {
    registerCareerMacros(() => {});
    db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE career_contracts (
      id TEXT PRIMARY KEY, world_id TEXT, employer_kind TEXT NOT NULL, employer_id TEXT NOT NULL,
      worker_kind TEXT NOT NULL, worker_id TEXT NOT NULL, track_id TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1, role TEXT, base_wage_sparks INTEGER NOT NULL DEFAULT 0,
      pay_model TEXT NOT NULL DEFAULT 'per_shift', duration_days INTEGER NOT NULL DEFAULT 30,
      signing_bonus_sparks INTEGER NOT NULL DEFAULT 0, bonuses_json TEXT NOT NULL DEFAULT '[]',
      clauses_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'offered',
      last_offer_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    db.exec(`CREATE TABLE player_career_progress (
      user_id TEXT NOT NULL, track_id TEXT NOT NULL, tier INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0, highest_tier INTEGER NOT NULL DEFAULT 1,
      shifts INTEGER NOT NULL DEFAULT 0, last_shift_day TEXT, last_shift_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (user_id, track_id))`);
    const ins = db.prepare(`INSERT INTO career_contracts (id, employer_kind, employer_id, worker_kind, worker_id, track_id, tier, role, base_wage_sparks, status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    ins.run("ct_1", "npc", "npc_marina", "player", "user-a", "culinary", 3, "Line cook", 120, "active");
    ins.run("ct_2", "player", "user-a", "npc", "npc_kip", "athletics", 2, "Sprinter", 80, "offered");
    ins.run("ct_3", "npc", "npc_hale", "player", "user-b", "culinary", 1, "Dishwasher", 40, "active");
    const prog = db.prepare(`INSERT INTO player_career_progress (user_id, track_id, tier, xp, highest_tier, shifts, last_shift_day) VALUES (?,?,?,?,?,?,?)`);
    prog.run("user-a", "culinary", 3, 260, 4, 41, "2026-11-12");
    prog.run("user-b", "culinary", 1, 10, 1, 2, "2026-11-10");
  });

  it("registers a provider for the careers domain", () => {
    assert.equal(hasLensExportProvider("careers"), true);
  });

  it("exports the caller's contracts as worker and as employer, with the bargain's terms", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "careers",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const contracts = out.artifacts.filter((r) => r.type === "contract");
    assert.equal(contracts.length, 2);
    const asWorker = contracts.find((r) => r.id === "ct_1");
    assert.equal(asWorker.data.myRole, "worker");
    assert.equal(asWorker.data.counterpartyKind, "npc");
    assert.equal(asWorker.data.trackId, "culinary");
    assert.equal(asWorker.data.baseWageSparks, 120);
    assert.equal(asWorker.data.status, "active");
    const asEmployer = contracts.find((r) => r.id === "ct_2");
    assert.equal(asEmployer.data.myRole, "employer");
    // no counterparty raw id anywhere in the export payload
    assert.equal(JSON.stringify(out.artifacts).includes("npc_marina"), false);
    assert.equal(JSON.stringify(out.artifacts).includes("npc_kip"), false);
  });

  it("exports the caller's per-track progress — shifts and ladder standing", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "careers",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const prog = out.artifacts.find((r) => r.type === "track-progress");
    assert.ok(prog, "progress row present");
    assert.equal(prog.data.trackId, "culinary");
    assert.equal(prog.data.tier, 3);
    assert.equal(prog.data.shifts, 41);
    assert.equal(prog.data.highestTier, 4);
  });

  it("never leaks another player's contracts or progress", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "careers",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "ct_3"), false);
    assert.equal(out.artifacts.filter((r) => r.type === "track-progress").length, 1);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "careers", ctx: { db },
    });
    assert.equal(out.artifacts.length, 0);
  });
});
