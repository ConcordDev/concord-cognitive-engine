// FIX-entity-013: the Entity lens export must include the caller's own
// spawned Registry entities. They are entity DTUs tagged only by
// machine.kind ("entity-node" / "entity-schema") — no domain — so the
// export's DTU leg can never match them to the "entity" domain; entity.js
// registers a lens export provider over the substrate's owner-scoped
// reads (listNodes / listSchemas over STATE.dtus).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerEntityActions = (await import("../domains/entity.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

const nodeDtu = (id, author, name, over = {}) => ({
  id, title: name, tier: "personal", privacy: "private", scope: "user",
  author, tags: [], createdAt: 1700000000000, relations: [],
  machine: { kind: "entity-node", entityType: "person", attributes: { role: { value: "founder", source: "manual" } }, wikidataId: null, ...over },
});
const schemaDtu = (id, author, className) => ({
  id, title: className, tier: "personal", privacy: "private", scope: "user",
  author, tags: [], createdAt: 1700000000000, relations: [],
  machine: { kind: "entity-schema", className, attributes: [{ name: "role", type: "string" }] },
});

describe("entity export provider (FIX-entity-013)", () => {
  before(() => {
    registerEntityActions(() => {});
    globalThis._concordSTATE = {
      dtus: new Map([
        ["g_a1", nodeDtu("g_a1", "user-a", "Ada Marlowe")],
        ["g_a2", nodeDtu("g_a2", "user-a", "Milltown", { entityType: "place", wikidataId: "Q123" })],
        ["g_b1", nodeDtu("g_b1", "user-b", "Someone else's entity")],
        ["g_s1", schemaDtu("g_s1", "user-a", "Founder")],
        ["g_s9", schemaDtu("g_s9", "user-b", "Other schema")],
      ]),
    };
  });

  it("registers a provider for the entity domain", () => {
    assert.equal(hasLensExportProvider("entity"), true);
  });

  it("exports the caller's own nodes and schemas", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "entity",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const ada = byId.get("g_a1");
    assert.ok(ada, "first own node present");
    assert.equal(ada.type, "entity-node");
    assert.equal(ada.title, "Ada Marlowe");
    assert.equal(ada.data.entityType, "person");
    assert.equal(ada.data.attributes.role.value, "founder");
    const place = byId.get("g_a2");
    assert.ok(place, "second own node present");
    assert.equal(place.data.wikidataId, "Q123");
    const schema = byId.get("g_s1");
    assert.ok(schema, "own schema present");
    assert.equal(schema.type, "entity-schema");
    assert.equal(schema.title, "Founder");
  });

  it("never leaks another user's entities or schemas", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "entity",
      ctx: { actor: { userId: "user-a" } },
    });
    const ids = new Set(out.artifacts.map((r) => r.id));
    assert.equal(ids.has("g_b1"), false);
    assert.equal(ids.has("g_s9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "entity", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
