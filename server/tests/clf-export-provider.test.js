// FIX-concord-link-frontier-004: the Concord-Link-Frontier export must
// include the caller's own Link records. They live in the domain's own
// stores (in-memory bucket backed by the concord_link_frontier_links
// table) — neither read by the shared export's legs — so the domain
// registers a lens export provider over its own merged read.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerClfActions = (await import("../domains/concord-link-frontier.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

function seedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE concord_link_frontier_links (
    id TEXT, user_id TEXT, name TEXT, bearing TEXT, mark TEXT,
    created_at TEXT, updated_at TEXT
  )`);
  db.prepare("INSERT INTO concord_link_frontier_links VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("lk_db1", "user-a", "Persisted link", "north", "surveyed", "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  return db;
}

describe("concord-link-frontier export provider (FIX-concord-link-frontier-004)", () => {
  let db;
  before(() => {
    registerClfActions(() => {});
    db = seedDb();
    globalThis._concordSTATE = {
      concordLinkFrontier: {
        links: new Map([
          ["user-a", [{ id: "lk_mem1", name: "Harbour link", bearing: "east", mark: null, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" }]],
          ["user-b", [{ id: "lk_mem9", name: "Someone else's link", bearing: "west", mark: null, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" }]],
        ]),
      },
    };
  });

  it("registers a provider for the concord-link-frontier domain", () => {
    assert.equal(hasLensExportProvider("concord-link-frontier"), true);
  });

  it("exports the caller's links from both the bucket and the table", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "concord-link-frontier",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const mem = byId.get("lk_mem1");
    assert.ok(mem, "bucket link present");
    assert.equal(mem.type, "link");
    assert.equal(mem.title, "Harbour link");
    assert.equal(mem.data.bearing, "east");
    const persisted = byId.get("lk_db1");
    assert.ok(persisted, "table link hydrated into the export");
    assert.equal(persisted.title, "Persisted link");
    assert.equal(persisted.data.mark, "surveyed");
  });

  it("never leaks another user's links", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "concord-link-frontier",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "lk_mem9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "concord-link-frontier", ctx: { db },
    });
    assert.equal(out.artifacts.length, 0);
  });
});
