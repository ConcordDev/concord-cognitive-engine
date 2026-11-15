// FIX-lfg-007: the LFG lens export must include the caller's own open
// request. Requests are rows in lfg_requests — not artifacts, not STATE —
// so domains/lfg.js registers a lens export provider for them. DDL mirrors
// server/migrations/219_party_lfg.js.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerLfgMacros = (await import("../domains/lfg.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

const NOW = Math.floor(Date.now() / 1000);

function seedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE lfg_requests (
    id TEXT PRIMARY KEY, requester_user_id TEXT NOT NULL, world_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'any', party_id TEXT,
    party_type TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 3600),
    matched_at INTEGER, party_max_size INTEGER NOT NULL DEFAULT 8,
    current_party_size INTEGER NOT NULL DEFAULT 1
  )`);
  const ins = db.prepare(`INSERT INTO lfg_requests
    (id, requester_user_id, world_id, role, party_type, status, note, created_at, expires_at, party_max_size, current_party_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("lfg-1", "user-a", "tunya", "healer", "normal", "open", "Healer LFG harvest dungeon", NOW - 60, NOW + 3600, 4, 1);
  ins.run("lfg-2", "user-b", "tunya", "dps", "normal", "open", "Someone else's request", NOW - 30, NOW + 3600, 4, 2);
  ins.run("lfg-3", "user-a", "tunya", "tank", "normal", "open", "Expired request", NOW - 7200, NOW - 3600, 4, 1);
  ins.run("lfg-4", "user-a", "tunya", "dps", "normal", "matched", "Already matched", NOW - 300, NOW + 3600, 4, 4);
  return db;
}

describe("lfg export provider (FIX-lfg-007)", () => {
  let db;
  before(() => {
    registerLfgMacros(() => {});
    db = seedDb();
  });

  it("registers a provider for the lfg domain", () => {
    assert.equal(hasLensExportProvider("lfg"), true);
  });

  it("exports the caller's open request", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "lfg",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    assert.equal(out.artifacts.length, 1);
    const row = out.artifacts[0];
    assert.equal(row.id, "lfg-1");
    assert.equal(row.type, "lfg-request");
    assert.equal(row.title, "Healer LFG harvest dungeon");
    assert.equal(row.data.role, "healer");
    assert.equal(row.data.worldId, "tunya");
  });

  it("excludes other users' requests, expired and matched ones", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "lfg",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const ids = new Set(out.artifacts.map((r) => r.id));
    assert.equal(ids.has("lfg-2"), false);
    assert.equal(ids.has("lfg-3"), false);
    assert.equal(ids.has("lfg-4"), false);
    assert.equal(JSON.stringify(out.artifacts).includes("user-b"), false);
  });

  it("exports nothing without a caller or a db", async () => {
    const anon = await collectLensExport({ runMacro: listMacro, domain: "lfg", ctx: { db } });
    assert.equal(anon.artifacts.length, 0);
    const noDb = await collectLensExport({ runMacro: listMacro, domain: "lfg", ctx: { actor: { userId: "user-a" } } });
    assert.equal(noDb.artifacts.length, 0);
  });
});
