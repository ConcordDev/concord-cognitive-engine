// FIX-world-creator-011: the World Creator export must include the
// caller's world drafts. Drafts live in STATE.worldCreatorLens.drafts,
// a per-user Map the export's state leg cannot enumerate, so the menu
// the universal chrome mounts exported everything except the worlds.
// world-creator.js registers a lens export provider over the drafts
// Map's own per-user buckets.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerWorldCreatorActions = (await import("../domains/world-creator.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

const draft = (id, name, over = {}) => ({
  id, name, description: "a test world", universeType: "concordia-hub",
  template: null, biome: "temperate_forest", rules: { gravity: 1 },
  props: [{ id: "prop_1", kind: "tree" }], spawnPoints: [], zones: [{ id: "zone_1" }],
  npcs: [], factions: [], terrain: { seed: 42, roughness: 0.5, waterLevel: 0.3 },
  visibility: "private", publishedWorldId: null,
  createdAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T01:00:00.000Z",
  ...over,
});

describe("world-creator export provider (FIX-world-creator-011)", () => {
  before(() => {
    registerWorldCreatorActions(() => {});
    globalThis._concordSTATE = {
      worldCreatorLens: {
        drafts: new Map([
          ["user-a", [draft("draft_1", "Emberfall"), draft("draft_2", "Saltmarsh", { visibility: "public", publishedWorldId: "world_9" })]],
          ["user-b", [draft("draft_9", "Someone else's world")]],
        ]),
      },
    };
  });

  it("registers a provider for the world-creator domain", () => {
    assert.equal(hasLensExportProvider("world-creator"), true);
  });

  it("exports the caller's drafts at full fidelity", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "world-creator",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const ember = byId.get("draft_1");
    assert.ok(ember, "first draft present");
    assert.equal(ember.type, "world-draft");
    assert.equal(ember.title, "Emberfall");
    assert.equal(ember.data.biome, "temperate_forest");
    assert.equal(ember.data.props.length, 1);
    assert.equal(ember.data.zones.length, 1);
    assert.equal(ember.data.terrain.seed, 42);
    const salt = byId.get("draft_2");
    assert.ok(salt, "second draft present");
    assert.equal(salt.data.visibility, "public");
    assert.equal(salt.data.publishedWorldId, "world_9");
  });

  it("never leaks another creator's drafts", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "world-creator",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "draft_9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "world-creator", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
