// FIX-move-builder-014: the Move Builder header export must include the
// caller's minted moves. A mint persists only as a legacy `dtus` table row
// (type='move_recipe'), which the platform DTU read model never returns —
// so move-builder.js registers a lens export provider over the same table
// its own list macro reads. DDL mirrors the runtime dtus shape (migrations
// 001 + 087) that mint/list detect via dtuColumns.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerMoveBuilderMacros = (await import("../domains/move-builder.js")).default;

// The production DTU leg cannot see legacy `dtus` rows (the bug), so the
// stub returns none — the provider alone must carry the moves.
const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

function seedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE dtus (
    id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT,
    data TEXT, created_at INTEGER
  )`);
  const ins = db.prepare("INSERT INTO dtus (id, type, title, creator_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const meta = (over) => JSON.stringify({ kind: "move_recipe", name: "x", skill_kind: "spell", element: "fire", tier: 2, allocation: { power: 2 }, motion: { motionFamily: "magic" }, balanced: true, ...over });
  ins.run("move:user-a:aaa111", "move_recipe", "Cinder Lance", "user-a", meta({ name: "Cinder Lance" }), 1700000000);
  ins.run("move:user-a:bbb222", "move_recipe", "Tide Step", "user-a", meta({ name: "Tide Step", element: "water", skill_kind: "dash" }), 1700000100);
  ins.run("move:user-b:ccc333", "move_recipe", "Someone else's move", "user-b", meta({ name: "Someone else's move" }), 1700000200);
  ins.run("spell:user-a:ddd444", "spell_recipe", "Not a move", "user-a", JSON.stringify({ kind: "spell_recipe" }), 1700000300);
  return db;
}

describe("move-builder export provider (FIX-move-builder-014)", () => {
  let db;
  before(() => {
    registerMoveBuilderMacros(() => {});
    db = seedDb();
  });

  it("registers a provider for the move-builder domain", () => {
    assert.equal(hasLensExportProvider("move-builder"), true);
  });

  it("exports the caller's minted moves with their build data", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "move-builder",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const lance = byId.get("move:user-a:aaa111");
    assert.ok(lance, "first minted move present");
    assert.equal(lance.type, "move");
    assert.equal(lance.title, "Cinder Lance");
    assert.equal(lance.data.element, "fire");
    assert.equal(lance.data.skillKind, "spell");
    assert.equal(lance.data.tier, 2);
    assert.ok(byId.get("move:user-a:bbb222"), "second minted move present");
  });

  it("excludes other users' moves and non-move DTUs", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "move-builder",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const ids = new Set(out.artifacts.map((r) => r.id));
    assert.equal(ids.has("move:user-b:ccc333"), false);
    assert.equal(ids.has("spell:user-a:ddd444"), false);
  });

  it("exports nothing without a caller or a db", async () => {
    const anon = await collectLensExport({ runMacro: listMacro, domain: "move-builder", ctx: { db } });
    assert.equal(anon.artifacts.length, 0);
    const noDb = await collectLensExport({ runMacro: listMacro, domain: "move-builder", ctx: { actor: { userId: "user-a" } } });
    assert.equal(noDb.artifacts.length, 0);
  });
});
