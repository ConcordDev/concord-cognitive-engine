// The world sim routes used to answer with a scripted festival, rollout
// percents, brain memory, and a library that does not exist. These tests
// store a row and require that row to come back.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { up as upSeasons } from "../migrations/134_seasons.js";
import { up as upFestivals } from "../migrations/235_festivals.js";
import { up as upPrefs } from "../migrations/492_sim_user_prefs.js";
import { startSeason, addSeasonChallenge, endSeason } from "../lib/world-progression.js";
import { BRAIN_CONFIG, noteEndpointFinish, _resetEndpointStats } from "../lib/brain-config.js";
import { _setSimProbeFetch } from "../lib/sim-live.js";

describe("world sim routes read stored data", () => {
  let db;
  let server;
  let url;
  const flagKey = "FF_WAVE14_TEST";
  const priorFlag = process.env[flagKey];

  before(async () => {
    endSeason();
    db = new Database(":memory:");
    upSeasons(db);
    upFestivals(db);
    upPrefs(db);
    db.exec(`
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY,
        type TEXT,
        title TEXT,
        creator_id TEXT,
        data TEXT,
        created_at TEXT
      );
      CREATE TABLE dtu_citations (
        dtu_id TEXT PRIMARY KEY,
        citation_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE royalty_lineage (
        id TEXT PRIMARY KEY,
        child_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1,
        creator_id TEXT NOT NULL,
        parent_creator TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        request_id TEXT,
        path TEXT,
        method TEXT,
        status_code INTEGER,
        details TEXT
      );
    `);
    db.prepare(`
      INSERT INTO world_seasons (world_id, season_idx, year_n, transitioned_at)
      VALUES ('world-1', 1, 4, 1)
    `).run();
    db.prepare(`
      INSERT INTO festivals
        (id, name, season_idx, day_in_season_start, day_in_season_end, content_pack)
      VALUES ('fest-1', 'Harvest Fair', 3, 0, 6, 'test')
    `).run();
    db.prepare(`
      INSERT INTO festival_active (festival_id, world_id, year_idx, ends_at)
      VALUES ('fest-1', 'world-1', 4, ?)
    `).run(Math.floor(Date.now() / 1000) + 86_400);
    db.prepare(`
      INSERT INTO season_events (id, world_id, season_idx, year_n, event_kind, narrative, occurred_at)
      VALUES ('evt-1', 'world-1', 1, 4, 'season:enter', 'Summer opens the river.', 10)
    `).run();
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, created_at)
      VALUES ('dtu-pier', 'building', 'Pier Beam Catalog', 'user-a', '{}', '2026-01-01'),
             ('dtu-root', 'note', 'Pier Foundation Note', 'user-a', '{}', '2025-12-01')
    `).run();
    db.prepare(`
      INSERT INTO dtu_citations (dtu_id, citation_count) VALUES ('dtu-pier', 3)
    `).run();
    db.prepare(`
      INSERT INTO royalty_lineage
        (id, child_id, parent_id, generation, creator_id, parent_creator)
      VALUES ('lin-1', 'dtu-pier', 'dtu-root', 1, 'user-a', 'user-a')
    `).run();
    db.prepare(`
      INSERT INTO audit_log
        (id, timestamp, category, action, user_id, path, method, status_code, details)
      VALUES
        ('aud-a', '2026-10-27T12:00:00.000Z', 'dtu', 'created', 'user-a', '/api/dtu', 'POST', 200, '{"target":"dtu-pier","token":"sekret"}'),
        ('aud-b', '2026-10-27T12:05:00.000Z', 'dtu', 'created', 'user-b', '/api/dtu', 'POST', 200, '{"target":"other"}')
    `).run();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/world", createWorldRoutes({
      requireAuth: (req, res, next) => {
        if (!req.user?.id) return res.status(401).json({ ok: false, error: "Authentication required" });
        next();
      },
      db,
    }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    endSeason();
    _resetEndpointStats();
    _setSimProbeFetch(null);
    if (priorFlag == null) delete process.env[flagKey];
    else process.env[flagKey] = priorFlag;
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  async function call(path, { user, method = "GET", body } = {}) {
    const headers = {};
    if (user) headers["x-user-id"] = user;
    if (body != null) headers["content-type"] = "application/json";
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it("names the stored season, festival, and challenge", async () => {
    const empty = await call("/api/world/sim/seasonal/current");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.activeEvent, null);
    assert.equal(empty.body.monthlyChallenge, null);
    assert.equal(empty.body.reason, "no_active_event");
    assert.equal(JSON.stringify(empty.body).includes("Spring Engineering"), false);
    assert.equal(JSON.stringify(empty.body).includes("Bridge"), false);

    const stored = await call("/api/world/sim/seasonal/current?worldId=world-1");
    assert.equal(stored.body.season, "summer");
    assert.equal(stored.body.seasonSource, "world_seasons");
    assert.equal(stored.body.year, 4);
    assert.equal(stored.body.activeEvent.name, "Harvest Fair");
    assert.equal(stored.body.activeEvent.source, "festival");
    assert.equal(stored.body.events[0].narrative, "Summer opens the river.");
    assert.equal(stored.body.reason, null);

    startSeason({ name: "Iron Season" });
    addSeasonChallenge({ name: "Mend the pier", description: "recorded", xpReward: 40 });
    const withChallenge = await call("/api/world/sim/seasonal/current?worldId=world-1");
    assert.equal(withChallenge.body.monthlyChallenge.title, "Mend the pier");
    assert.equal(withChallenge.body.monthlyChallenge.source, "season");
    assert.equal(withChallenge.body.monthlyChallenge.xpReward, 40);
    endSeason();
  });

  it("saves accessibility and settings for the signed-in user", async () => {
    const stranger = await call("/api/world/sim/accessibility/user-a");
    assert.equal(stranger.status, 403);

    const missing = await call("/api/world/sim/accessibility/user-a", { user: "user-a" });
    assert.equal(missing.status, 501);
    assert.equal(missing.body.reason, "no_saved_settings");

    const saved = await call("/api/world/sim/accessibility/user-a", {
      user: "user-a",
      method: "POST",
      body: { reducedMotion: true, textScale: 1.4 },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.reducedMotion, true);

    const again = await call("/api/world/sim/accessibility/user-a", { user: "user-a" });
    assert.equal(again.body.settings.reducedMotion, true);
    assert.equal(again.body.settings.textScale, 1.4);
    assert.equal(JSON.stringify(again.body).includes("screenReaderEnabled"), false);

    const other = await call("/api/world/sim/accessibility/user-a", { user: "user-b" });
    assert.equal(other.status, 403);

    const settings = await call("/api/world/sim/settings/user-a", {
      user: "user-a",
      method: "POST",
      body: { graphics: "low", audio: { master: 0.2 } },
    });
    assert.equal(settings.status, 200);
    const read = await call("/api/world/sim/settings/user-a", { user: "user-a" });
    assert.equal(read.body.settings.graphics, "low");
    assert.equal(read.body.settings.audio.master, 0.2);
    assert.equal(read.body.settings.locale, undefined);
  });

  it("reports FF_* on/off and omits rollout percents", async () => {
    process.env[flagKey] = "off";
    const res = await call("/api/world/sim/feature-flags");
    assert.equal(res.status, 200);
    assert.equal(res.body.flags[flagKey].enabled, false);
    assert.equal(res.body.flags[flagKey].source, "env");
    assert.equal(typeof res.body.flags.FF_DX_SOCKET.enabled, "boolean");
    assert.equal(JSON.stringify(res.body).includes("rollout"), false);
    assert.equal(Object.hasOwn(res.body.flags.FF_DX_SOCKET, "rolloutPercent"), false);
    delete process.env[flagKey];
  });

  it("counts finished brain calls and probes tags without inventing memory", async () => {
    const target = BRAIN_CONFIG.utility.url;
    assert.ok(target);
    noteEndpointFinish(target, { ok: true });
    let probed = [];
    _setSimProbeFetch(async (probeUrl) => {
      probed.push(probeUrl);
      return {
        ok: true,
        json: async () => ({ models: [{ name: BRAIN_CONFIG.utility.model }] }),
      };
    });
    const res = await call("/api/world/sim/ai/status?probe=1");
    assert.equal(res.status, 200);
    assert.equal(res.body.brains.utility.model, BRAIN_CONFIG.utility.model);
    assert.equal(res.body.brains.utility.reachable, true);
    assert.equal(res.body.brains.utility.status, "running");
    assert.ok(res.body.brains.utility.completed >= 1);
    assert.ok(res.body.totalInferences >= 1);
    assert.equal(res.body.totalInferences24h, null);
    assert.equal(res.body.avgLatencyMs, null);
    assert.equal(JSON.stringify(res.body).includes("memoryGB"), false);
    assert.equal(JSON.stringify(res.body).includes("18420"), false);
    assert.ok(probed.some((u) => u.endsWith("/api/tags")));
    assert.ok(probed.some((u) => u.endsWith("/api/ps")));
    assert.equal(probed.some((u) => u === target), false);
  });

  it("searches stored DTUs and does not invent a library", async () => {
    const missing = await call("/api/world/sim/search/semantic", {
      method: "POST",
      body: {},
    });
    assert.equal(missing.status, 400);

    const found = await call("/api/world/sim/search/semantic", {
      user: "user-a",
      method: "POST",
      body: { query: "Pier Beam", limit: 5 },
    });
    assert.equal(found.status, 200);
    assert.equal(found.body.results.some((r) => r.id === "dtu-pier" && r.title === "Pier Beam Catalog"), true);
    assert.equal(typeof found.body.semantic, "boolean");
    assert.equal(JSON.stringify(found.body).includes("Riverside"), false);
    assert.equal(JSON.stringify(found.body).includes("all-MiniLM"), false);
  });

  it("returns the stored citation graph", async () => {
    const missing = await call("/api/world/sim/knowledge/query", {
      method: "POST",
      body: {},
    });
    assert.equal(missing.status, 400);

    const unknown = await call("/api/world/sim/knowledge/query", {
      method: "POST",
      body: { startId: "dtu-missing" },
    });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.reason, "not_found");
    assert.equal(JSON.stringify(unknown.body).includes("Riverside"), false);

    const found = await call("/api/world/sim/knowledge/query", {
      method: "POST",
      body: { startId: "dtu-pier", depth: 1 },
    });
    assert.equal(found.status, 200);
    assert.equal(found.body.reason, null);
    const pier = found.body.graph.nodes.find((n) => n.id === "dtu-pier");
    assert.equal(pier.title || pier.label, "Pier Beam Catalog");
    assert.equal(pier.citations, 3);
    assert.equal(found.body.graph.edges.some((e) => e.from === "dtu-pier" && e.to === "dtu-root" && e.type === "cites"), true);
    assert.equal(JSON.stringify(found.body).includes("ArchitectX"), false);
    assert.equal(JSON.stringify(found.body).includes("47"), false);
  });

  it("returns only the caller's audit rows", async () => {
    const anon = await call("/api/world/sim/audit-log");
    assert.equal(anon.status, 401);

    const mine = await call("/api/world/sim/audit-log", { user: "user-a" });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.total, 1);
    assert.equal(mine.body.logs[0].id, "aud-a");
    assert.equal(mine.body.logs[0].event, "dtu.created");
    assert.equal(mine.body.logs[0].details.target, "dtu-pier");
    assert.equal(mine.body.logs[0].details.token, undefined);
    assert.equal(JSON.stringify(mine.body).includes("sekret"), false);
    assert.equal(JSON.stringify(mine.body).includes("user-b"), false);
    assert.equal(JSON.stringify(mine.body).includes("audit-1"), false);
  });
});
