// FIX-crisis-ops-009: the crisis lens export must include the caller's own
// crises, assets (resources) and responders — not only incident-report
// artifacts. Crisis state lives in globalThis._concordSTATE stores, which
// the artifact leg of collectLensExport cannot see; crisis.js therefore
// registers a lens export provider. These tests pin the provider's rows
// and its caller scoping.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerCrisisMacros = (await import("../domains/crisis.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

function seedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE world_crises (
    id TEXT, type TEXT, description TEXT, origin_world_id TEXT,
    started_at INTEGER, resolved_at INTEGER
  )`);
  const ins = db.prepare("INSERT INTO world_crises VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("crisis-1", "flood", "River flood in Milltown", "world-1", 1000, null);
  ins.run("crisis-2", "wildfire", "Hill fire near Ashford", "world-1", 2000, null);
  return db;
}

function seedState() {
  globalThis._concordSTATE = {
    crisisPlaybookProgress: new Map(),
    crisisAlertAcks: new Map(),
    crisisTimelines: new Map([
      ["crisis-1", [{ id: "ev1", kind: "declare", note: "declared", by: "user-a", at: 1000, authority: "declarer" }]],
      ["crisis-2", [{ id: "ev2", kind: "declare", note: "declared", by: "user-b", at: 2000, authority: "declarer" }]],
    ]),
    crisisTeams: new Map([
      ["crisis-1", [
        { id: "m1", responder: "Alex Rivers", role: "incident_commander", assignedBy: "user-a", assignedAt: 111 },
        { id: "m2", responder: "Sam Poe", role: "responder", assignedBy: "user-b", assignedAt: 112 },
      ]],
      ["crisis-2", [
        { id: "m3", responder: "Jo Kim", role: "responder", assignedBy: "user-b", assignedAt: 113 },
      ]],
    ]),
    crisisResources: new Map([
      ["user-a", new Map([["res-1", { id: "res-1", name: "Water pump", category: "equipment", quantity: 3, unit: "units", deployed: 1, createdAt: 100, updatedAt: 200 }]])],
      ["user-b", new Map([["res-9", { id: "res-9", name: "Sandbag pallet", category: "supplies", quantity: 40, unit: "units", deployed: 0, createdAt: 300, updatedAt: 300 }]])],
    ]),
  };
}

describe("crisis export provider (FIX-crisis-ops-009)", () => {
  let db;
  before(() => {
    registerCrisisMacros(() => {});
    db = seedDb();
    seedState();
  });

  it("registers a provider for the crisis domain", () => {
    assert.equal(hasLensExportProvider("crisis"), true);
  });

  it("exports the caller's declared crisis, assets and responders", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "crisis",
      ctx: { db, actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const crisis = byId.get("crisis-1");
    assert.ok(crisis, "declared crisis row present");
    assert.equal(crisis.type, "crisis");
    assert.equal(crisis.title, "River flood in Milltown");
    assert.equal(crisis.data.crisisType, "flood");
    const asset = byId.get("res-1");
    assert.ok(asset, "caller asset row present");
    assert.equal(asset.type, "asset");
    assert.equal(asset.title, "Water pump");
    assert.equal(asset.data.quantity, 3);
    const m1 = byId.get("m1");
    assert.ok(m1, "responder row present");
    assert.equal(m1.type, "responder");
    assert.equal(m1.title, "Alex Rivers");
    assert.equal(m1.data.role, "incident_commander");
    assert.equal(m1.data.assignedByIsMe, true);
    assert.ok(byId.get("m2"), "teammate on the caller's crisis is exported");
  });

  it("never leaks another user's crisis, assets or roster", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "crisis",
      ctx: { db, actor: { userId: "user-a" } },
    });
    const ids = new Set(out.artifacts.map((r) => r.id));
    assert.equal(ids.has("crisis-2"), false);
    assert.equal(ids.has("res-9"), false);
    assert.equal(ids.has("m3"), false);
    const raw = JSON.stringify(out.artifacts);
    assert.equal(raw.includes("user-a"), false, "no raw actor id in export rows");
    assert.equal(raw.includes("user-b"), false, "no raw actor id in export rows");
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "crisis", ctx: { db },
    });
    assert.equal(out.artifacts.length, 0);
  });
});
