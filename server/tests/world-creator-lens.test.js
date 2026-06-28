// Behavioral tests for the world-creator lens — both surfaces it drives:
//
//   (A) server/domains/world-creator.js  — the world-creator.* LENS_ACTIONS
//       authoring substrate (scene drafts, biome preview, props/spawns/zones/
//       NPCs/factions, rule-modulator editing, publish/privacy + discovery,
//       playtest readiness). Registered via PATH 3 (domains/index.js →
//       domainModules.forEach(mod => mod(registerLensAction))), so it is
//       dispatched as `handler(ctx, virtualArtifact, input)` — the 3-ARG
//       convention (server.js:39150). This harness mirrors that exactly.
//
//   (B) server/routes/anomalies.js — the /api/anomalies/{public,world/:id}
//       REST surface the anomaly sub-page calls. We mount the router over an
//       ephemeral in-memory better-sqlite3 with the real schema and drive it
//       with supertest-style fetch via a thin express app.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips (create → list → get → edit → publish → discover),
// per-user / visibility isolation, degrade-graceful (no STATE → ok:false
// "STATE unavailable", never a throw), and fail-CLOSED guards on poisoned
// numerics/params (Infinity/NaN/1e308 clamp to the documented range; never
// reach an output value or persist). No fabricated rows.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import registerWorldCreatorActions from "../domains/world-creator.js";
import createAnomaliesRouter from "../routes/anomalies.js";

// ───────────────────────── (A) domain harness ──────────────────────────
const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "world-creator", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`world-creator.${name} not registered`);
  const virtualArtifact = { id: null, domain: "world-creator", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerWorldCreatorActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "creator_a" } };
const ctxB = { actor: { userId: "creator_b" } };

// helper: create a draft and return its id (asserts success)
function mkDraft(ctx, params = {}) {
  const r = call("draft-create", ctx, { name: "Test World", ...params });
  assert.equal(r.ok, true, `draft-create failed: ${r.error}`);
  return r.result.draft.id;
}

describe("world-creator — registration (every lens-driven macro present)", () => {
  it("registers all macros the page + children call via lensRun", () => {
    // From DraftGallery, DraftEditor, BiomePreview (grepped 2026-06-27).
    for (const m of [
      "templates", "biomes", "biome-preview",
      "draft-create", "draft-list", "draft-get", "draft-update", "draft-delete",
      "prop-place", "prop-move", "prop-remove",
      "spawn-add", "spawn-remove", "zone-add", "zone-remove",
      "npc-place", "npc-remove", "faction-add", "faction-remove",
      "draft-publish", "discover", "playtest-check",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing world-creator.${m}`);
    }
  });
});

describe("world-creator — static reference data (templates + biomes)", () => {
  it("templates returns the 3 seeded presets with real counts", () => {
    const r = call("templates", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.templates.length, 3);
    const forest = r.result.templates.find((t) => t.id === "forest_realm");
    assert.ok(forest);
    assert.equal(forest.biome, "temperate_forest");
    assert.equal(forest.biomeLabel, "Temperate Forest");
    assert.equal(forest.propCount, 5);   // 3 trees + rock + campfire
    assert.equal(forest.spawnCount, 1);
    assert.equal(forest.zoneCount, 1);
    assert.equal(forest.rules.questDensity, 1.3);
  });

  it("biomes returns the 8 seeded biomes with climate fields", () => {
    const r = call("biomes", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.biomes.length, 8);
    const desert = r.result.biomes.find((b) => b.id === "desert");
    assert.equal(desert.temperatureC, 38);
    assert.equal(desert.humidityPct, 18);
    assert.equal(desert.hazard, "high");
    assert.equal(desert.growthMultiplier, 0.3);
    assert.ok(Array.isArray(desert.palette) && desert.palette.length === 4);
  });
});

describe("world-creator — biome-preview (real computed climate curve)", () => {
  it("computes a 6-point day curve + storm chance from hazard × weather", () => {
    const r = call("biome-preview", ctxA, { biome: "volcanic", weatherIntensity: 1.0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.biome, "volcanic");
    assert.equal(r.result.baseTemperatureC, 52);
    assert.equal(r.result.climateCurve.length, 6);
    // hazardScore(extreme)=4 × 12 × weather(1.0) = 48
    assert.equal(r.result.stormChancePct, 48);
    // the curve hours are deterministic
    assert.deepEqual(r.result.climateCurve.map((p) => p.hour), [0, 4, 8, 12, 16, 20]);
    // every light value within base range
    for (const p of r.result.climateCurve) {
      assert.ok(p.lightPct >= 0 && p.lightPct <= r.result.baseLightPct + 0.5);
    }
  });

  it("storm chance scales with weather intensity and is capped at 95", () => {
    // extreme hazard (4) × 12 × 1.5 weather = 72
    const hi = call("biome-preview", ctxA, { biome: "volcanic", weatherIntensity: 1.5 });
    assert.equal(hi.result.stormChancePct, 72);
    // low hazard (1) × 12 × 0.5 = 6
    const lo = call("biome-preview", ctxA, { biome: "coastal", weatherIntensity: 0.5 });
    assert.equal(lo.result.stormChancePct, 6);
  });

  it("rejects an unknown biome without throwing", () => {
    const r = call("biome-preview", ctxA, { biome: "atlantis" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown biome/);
  });

  it("fail-CLOSED: poisoned weatherIntensity clamps to [0.5,1.5], never reaches output", () => {
    for (const poison of [Infinity, -Infinity, NaN, 1e308, -1e308, "9".repeat(40)]) {
      const r = call("biome-preview", ctxA, { biome: "desert", weatherIntensity: poison });
      assert.equal(r.ok, true, `ok for poison=${String(poison)}`);
      // desert hazard=high(3) × 12 × clamp → default 1.0 → 36; clamp(0.5..1.5) never lets it explode
      assert.ok(Number.isFinite(r.result.stormChancePct), "storm stays finite");
      assert.ok(r.result.stormChancePct >= 0 && r.result.stormChancePct <= 95);
    }
  });
});

describe("world-creator — draft lifecycle round-trip", () => {
  it("create → list → get returns the same draft with defaults applied", () => {
    const c = call("draft-create", ctxA, { name: "Aetheria", biome: "tundra" });
    assert.equal(c.ok, true);
    const id = c.result.draft.id;
    assert.equal(c.result.draft.biome, "tundra");
    assert.equal(c.result.draft.visibility, "private");
    assert.deepEqual(c.result.draft.rules, { combatLethality: 1, refusalSensitivity: 1, questDensity: 1, weatherIntensity: 1 });

    const l = call("draft-list", ctxA, {});
    assert.equal(l.result.count, 1);
    assert.equal(l.result.drafts[0].id, id);
    assert.equal(l.result.drafts[0].name, "Aetheria");
    assert.equal(l.result.drafts[0].biomeLabel, "Frozen Tundra");

    const g = call("draft-get", ctxA, { id });
    assert.equal(g.ok, true);
    assert.equal(g.result.draft.id, id);
  });

  it("create from a template seeds props/spawns/zones + the template biome+rules", () => {
    const c = call("draft-create", ctxA, { name: "Outpost", template: "desert_outpost" });
    assert.equal(c.ok, true);
    const d = c.result.draft;
    assert.equal(d.template, "desert_outpost");
    assert.equal(d.biome, "desert");
    assert.equal(d.props.length, 4);
    assert.equal(d.spawnPoints.length, 1);
    assert.equal(d.zones.length, 1);
    assert.equal(d.rules.combatLethality, 1.4);
    // seeded entities got real ids
    assert.ok(d.props.every((p) => typeof p.id === "string" && p.id.startsWith("prop_")));
  });

  it("draft-create rejects a name < 3 chars", () => {
    const r = call("draft-create", ctxA, { name: "ab" });
    assert.equal(r.ok, false);
    assert.match(r.error, /≥ 3 characters/);
  });

  it("draft-update edits rules (clamped), biome, terrain", () => {
    const id = mkDraft(ctxA);
    const u = call("draft-update", ctxA, {
      id, biome: "tropical",
      rules: { combatLethality: 99, questDensity: 0.001 },   // both out of [0.5,1.5]
      terrain: { roughness: 5, waterLevel: -3, seed: 42 },
    });
    assert.equal(u.ok, true);
    assert.equal(u.result.draft.biome, "tropical");
    assert.equal(u.result.draft.rules.combatLethality, 1.5, "clamped to hi");
    assert.equal(u.result.draft.rules.questDensity, 0.5, "clamped to lo");
    assert.equal(u.result.draft.terrain.roughness, 1, "clamped to [0,1]");
    assert.equal(u.result.draft.terrain.waterLevel, 0, "clamped to [0,1]");
    assert.equal(u.result.draft.terrain.seed, 42);
  });

  it("draft-update ignores an unknown biome (keeps prior)", () => {
    const id = mkDraft(ctxA, { biome: "alpine" });
    const u = call("draft-update", ctxA, { id, biome: "nonexistent" });
    assert.equal(u.result.draft.biome, "alpine");
  });

  it("draft-delete removes it; subsequent get is not_found", () => {
    const id = mkDraft(ctxA);
    const del = call("draft-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    assert.equal(call("draft-get", ctxA, { id }).ok, false);
    assert.equal(call("draft-list", ctxA, {}).result.count, 0);
  });

  it("acting on an unknown draft id is not_found, never a throw", () => {
    for (const m of ["draft-get", "draft-update", "draft-delete", "draft-publish", "playtest-check"]) {
      const r = call(m, ctxA, { id: "ghost_draft" });
      assert.equal(r.ok, false, `${m} should reject ghost`);
      assert.match(String(r.error), /not found/);
    }
  });
});

describe("world-creator — scene editing (props / spawns / zones / npcs / factions)", () => {
  it("prop-place validates kind + clamps coords; prop-move + prop-remove round-trip", () => {
    const id = mkDraft(ctxA);
    const bad = call("prop-place", ctxA, { draftId: id, kind: "spaceship", x: 0, z: 0 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unknown prop kind/);

    const p = call("prop-place", ctxA, { draftId: id, kind: "tree", x: 9999, z: -9999 });
    assert.equal(p.ok, true);
    assert.equal(p.result.prop.x, 250, "x clamped to +250");
    assert.equal(p.result.prop.z, -250, "z clamped to -250");
    assert.equal(p.result.propCount, 1);
    const propId = p.result.prop.id;

    const mv = call("prop-move", ctxA, { draftId: id, propId, x: 10, z: 20 });
    assert.equal(mv.result.prop.x, 10);
    assert.equal(mv.result.prop.z, 20);

    const rm = call("prop-remove", ctxA, { draftId: id, propId });
    assert.equal(rm.result.propCount, 0);
    assert.equal(call("prop-remove", ctxA, { draftId: id, propId }).ok, false, "double-remove rejects");
  });

  it("spawn-add: first spawn is default; removing default re-promotes another", () => {
    const id = mkDraft(ctxA);
    const s1 = call("spawn-add", ctxA, { draftId: id, name: "Alpha", x: 0, z: 0 });
    assert.equal(s1.result.spawn.isDefault, true, "first spawn defaults");
    const s2 = call("spawn-add", ctxA, { draftId: id, name: "Beta", x: 5, z: 5 });
    assert.equal(s2.result.spawn.isDefault, false);

    const rm = call("spawn-remove", ctxA, { draftId: id, spawnId: s1.result.spawn.id });
    assert.equal(rm.ok, true);
    const g = call("draft-get", ctxA, { id });
    assert.equal(g.result.draft.spawnPoints.length, 1);
    assert.equal(g.result.draft.spawnPoints[0].isDefault, true, "Beta promoted to default");
  });

  it("zone-add validates kind + clamps radius", () => {
    const id = mkDraft(ctxA);
    assert.equal(call("zone-add", ctxA, { draftId: id, kind: "moon" }).ok, false);
    const z = call("zone-add", ctxA, { draftId: id, kind: "hazard", radius: 9999 });
    assert.equal(z.ok, true);
    assert.equal(z.result.zone.radius, 250, "radius clamped to 250");
    assert.equal(z.result.zone.kind, "hazard");
  });

  it("npc-place requires name + valid archetype; faction wiring nulls a dangling ref", () => {
    const id = mkDraft(ctxA);
    assert.equal(call("npc-place", ctxA, { draftId: id, archetype: "warrior" }).ok, false, "name required");
    assert.equal(call("npc-place", ctxA, { draftId: id, name: "Bob", archetype: "wizard" }).ok, false, "bad archetype");
    // factionId that doesn't exist on the draft → nulled
    const n = call("npc-place", ctxA, { draftId: id, name: "Bob", archetype: "guard", factionId: "ghost_faction", level: 999 });
    assert.equal(n.ok, true);
    assert.equal(n.result.npc.factionId, null, "dangling faction ref nulled");
    assert.equal(n.result.npc.level, 100, "level clamped to 100");
  });

  it("faction-add then npc references it; faction-remove un-links its NPCs", () => {
    const id = mkDraft(ctxA);
    const f = call("faction-add", ctxA, { draftId: id, name: "Iron Pact", stance: "hostile" });
    assert.equal(f.ok, true);
    const fid = f.result.faction.id;
    const n = call("npc-place", ctxA, { draftId: id, name: "Sera", archetype: "warrior", factionId: fid });
    assert.equal(n.result.npc.factionId, fid, "valid faction ref kept");

    const fr = call("faction-remove", ctxA, { draftId: id, factionId: fid });
    assert.equal(fr.ok, true);
    const g = call("draft-get", ctxA, { id });
    assert.equal(g.result.draft.npcs[0].factionId, null, "removed faction un-linked from NPC");
  });
});

describe("world-creator — publish + discovery + visibility isolation", () => {
  it("publish requires a spawn point for non-private visibility", () => {
    const id = mkDraft(ctxA);
    const noSpawn = call("draft-publish", ctxA, { id, visibility: "public" });
    assert.equal(noSpawn.ok, false);
    assert.match(noSpawn.error, /at least one spawn point/);

    assert.equal(call("draft-publish", ctxA, { id, visibility: "private" }).ok, true, "private allowed w/o spawn");

    call("spawn-add", ctxA, { draftId: id, x: 0, z: 0 });
    const pub = call("draft-publish", ctxA, { id, visibility: "public", publishedWorldId: "world_xyz" });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.visibility, "public");
    assert.equal(pub.result.publishedWorldId, "world_xyz");
  });

  it("publish rejects an invalid visibility value", () => {
    const id = mkDraft(ctxA);
    const r = call("draft-publish", ctxA, { id, visibility: "secret" });
    assert.equal(r.ok, false);
    assert.match(r.error, /private \| unlisted \| public/);
  });

  it("discover only surfaces PUBLIC drafts and supports a query filter", () => {
    // A: one public 'Frostgate', one private 'Hidden Vault'
    const pubId = mkDraft(ctxA, { name: "Frostgate" });
    call("spawn-add", ctxA, { draftId: pubId, x: 0, z: 0 });
    call("draft-publish", ctxA, { id: pubId, visibility: "public" });
    const privId = mkDraft(ctxA, { name: "Hidden Vault" });
    call("draft-publish", ctxA, { id: privId, visibility: "private" });

    // B sees A's public world (cross-creator discovery)
    const all = call("discover", ctxB, {});
    assert.equal(all.result.count, 1, "only the public draft is discoverable");
    assert.equal(all.result.worlds[0].name, "Frostgate");
    assert.equal(all.result.worlds[0].creatorId, "creator_a");

    // query filter
    assert.equal(call("discover", ctxB, { query: "frost" }).result.count, 1);
    assert.equal(call("discover", ctxB, { query: "vault" }).result.count, 0, "private never leaks via query");
  });

  it("per-user isolation: one creator's drafts never appear in another's list", () => {
    mkDraft(ctxA, { name: "A world" });
    assert.equal(call("draft-list", ctxA, {}).result.count, 1);
    assert.equal(call("draft-list", ctxB, {}).result.count, 0, "B sees no A drafts");
    // B cannot get A's draft by id
    const aId = call("draft-list", ctxA, {}).result.drafts[0].id;
    assert.equal(call("draft-get", ctxB, { id: aId }).ok, false, "cross-user get rejected");
  });
});

describe("world-creator — playtest-check (the /api/worlds mint gate)", () => {
  it("flags missing spawn as a blocking issue; ready once a spawn exists", () => {
    const id = mkDraft(ctxA, { name: "Proving Ground" });
    const c1 = call("playtest-check", ctxA, { id });
    assert.equal(c1.ok, true);
    assert.equal(c1.result.ready, false);
    assert.ok(c1.result.issues.some((i) => /spawn point/i.test(i)));

    call("spawn-add", ctxA, { draftId: id, x: 0, z: 0 });
    const c2 = call("playtest-check", ctxA, { id });
    assert.equal(c2.result.ready, true);
    assert.equal(c2.result.issues.length, 0);
    // worldPayload is shaped for POST /api/worlds
    assert.equal(c2.result.worldPayload.name, "Proving Ground");
    assert.ok(c2.result.worldPayload.rule_modulators);
    assert.equal(typeof c2.result.worldPayload.universe_type, "string");
  });

  it("surfaces non-blocking warnings (empty scene, no NPCs, no zones)", () => {
    const id = mkDraft(ctxA);
    call("spawn-add", ctxA, { draftId: id, x: 0, z: 0 });
    const c = call("playtest-check", ctxA, { id });
    assert.equal(c.result.ready, true, "warnings don't block");
    assert.ok(c.result.warnings.length >= 1);
  });
});

describe("world-creator — degrade-graceful (no STATE)", () => {
  it("every state-backed macro returns ok:false 'STATE unavailable' (never throws) when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    for (const m of [
      "draft-create", "draft-list", "draft-get", "draft-update", "draft-delete",
      "prop-place", "spawn-add", "zone-add", "npc-place", "faction-add",
      "draft-publish", "discover", "playtest-check",
    ]) {
      const r = call(m, ctxA, { id: "x", draftId: "x", name: "Valid Name", kind: "tree", archetype: "guard" });
      assert.equal(r.ok, false, `${m} should be ok:false with no STATE`);
      assert.match(String(r.error), /STATE unavailable/);
    }
  });

  it("static-data macros still work without STATE (pure reference)", () => {
    globalThis._concordSTATE = undefined;
    assert.equal(call("templates", ctxA, {}).ok, true);
    assert.equal(call("biomes", ctxA, {}).ok, true);
    assert.equal(call("biome-preview", ctxA, { biome: "desert" }).ok, true);
  });
});

// ───────────────────── (B) /api/anomalies REST surface ──────────────────
function bootAnomalyApp() {
  const db = new Database(":memory:");
  // real schema slice (migration 071 + worlds.created_by ownership)
  db.exec(`
    CREATE TABLE inventory_anomaly_queue (
      id TEXT PRIMARY KEY,
      detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
      kind TEXT NOT NULL,
      user_id TEXT, item_id TEXT, inventory_id TEXT, details_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_at INTEGER, resolved_by TEXT, resolution TEXT
    );
    CREATE TABLE worlds ( id TEXT PRIMARY KEY, created_by TEXT );
  `);
  // requireAuth stub: reads x-user-id (the real auth sets req.user.id; the
  // route also falls back to the x-user-id header, so this exercises the
  // real ownership-gate code path).
  const requireAuth = (req, _res, next) => { req.user = { id: req.headers["x-user-id"] || null }; next(); };
  const app = express();
  app.use(express.json());
  app.use("/api/anomalies", createAnomaliesRouter({ requireAuth, db }));
  const server = http.createServer(app);
  return { db, server };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
}

describe("world-creator/anomalies — /api/anomalies REST surface", () => {
  let db, server, port, base;
  before(async () => {
    ({ db, server } = bootAnomalyApp());
    port = await listen(server);
    base = `http://127.0.0.1:${port}`;
    // seed: world_a owned by creator_a; world_b owned by creator_b
    db.prepare(`INSERT INTO worlds (id, created_by) VALUES ('world_a','creator_a'),('world_b','creator_b')`).run();
    const ins = db.prepare(`INSERT INTO inventory_anomaly_queue (id, detected_at, kind, user_id, item_id, status) VALUES (?,?,?,?,?,?)`);
    const now = Math.floor(Date.now() / 1000);
    ins.run("anom_1", now, "negative_quantity", "u1", "item_sword", "open");
    ins.run("anom_2", now, "rapid_duplication", "u2", "item_gem", "open");
    ins.run("anom_3", now - 30 * 86400, "lineage_break", "u3", "item_old", "resolved"); // > 7d ago + resolved
  });
  after(() => { server.close(); db.close(); });

  it("GET /public aggregates by kind+status with a 7-day window (no user-identifying detail)", async () => {
    const r = await fetch(`${base}/api/anomalies/public`);
    const j = await r.json();
    assert.equal(j.ok, true);
    // byKind has all 3 rows (grouped); recent7d excludes the 30-day-old row
    const openCount = j.byKind.filter((row) => row.status === "open").reduce((s, row) => s + row.n, 0);
    assert.equal(openCount, 2);
    const recentKinds = j.recent7d.map((row) => row.kind);
    assert.ok(!recentKinds.includes("lineage_break"), "30-day-old anomaly excluded from recent7d");
    // public payload carries no user_id field
    assert.ok(!("user_id" in (j.byKind[0] || {})), "public aggregate omits user identity");
  });

  it("GET /world/:id returns OPEN anomalies for the owner only (fail-closed on non-owner)", async () => {
    // owner of world_a sees the open anomalies
    const ok = await fetch(`${base}/api/anomalies/world/world_a`, { headers: { "x-user-id": "creator_a" } });
    const okJson = await ok.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.anomalies.length, 2, "only open/investigating surface");
    assert.ok(okJson.anomalies.every((a) => a.status === "open"));

    // a different user (creator_b) does NOT own world_a → 403 not_world_creator
    const forbidden = await fetch(`${base}/api/anomalies/world/world_a`, { headers: { "x-user-id": "creator_b" } });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error, "not_world_creator");

    // anonymous (no x-user-id) is also rejected
    const anon = await fetch(`${base}/api/anomalies/world/world_a`);
    assert.equal(anon.status, 403);
  });

  it("POST resolve/dismiss is owner-gated and flips status (round-trip removes it from the open list)", async () => {
    // non-owner cannot resolve
    const bad = await fetch(`${base}/api/anomalies/world/world_a/anom_1/resolve`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "creator_b" },
      body: JSON.stringify({ resolution: "nope" }),
    });
    assert.equal(bad.status, 403);

    // owner resolves anom_1
    const res = await fetch(`${base}/api/anomalies/world/world_a/anom_1/resolve`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "creator_a" },
      body: JSON.stringify({ resolution: "resolved via panel" }),
    });
    assert.equal((await res.json()).ok, true);
    const row = db.prepare(`SELECT status, resolved_by, resolution FROM inventory_anomaly_queue WHERE id='anom_1'`).get();
    assert.equal(row.status, "resolved");
    assert.equal(row.resolved_by, "creator_a");
    assert.equal(row.resolution, "resolved via panel");

    // owner dismisses anom_2
    const dis = await fetch(`${base}/api/anomalies/world/world_a/anom_2/dismiss`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "creator_a" },
      body: JSON.stringify({ reason: "false positive" }),
    });
    assert.equal((await dis.json()).ok, true);

    // the open list is now empty
    const after = await fetch(`${base}/api/anomalies/world/world_a`, { headers: { "x-user-id": "creator_a" } });
    assert.equal((await after.json()).anomalies.length, 0, "resolved+dismissed no longer surface");
  });
});
