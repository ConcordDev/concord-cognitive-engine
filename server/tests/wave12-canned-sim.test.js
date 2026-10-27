// Sim routes that answered with a canned "current" world: a spring festival
// in every month, brain telemetry, search hits, a knowledge graph, an audit
// log, feature-flag rollouts, and settings the user never saved.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createWorldRoutes from "../routes/world.js";
import { startSeason, endSeason, getCurrentSeason } from "../lib/world-progression.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("sim routes do not invent a current world", () => {
  let app;

  before(async () => {
    endSeason();
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    expressApp.use("/api/world", createWorldRoutes({
      requireAuth: (_req, _res, next) => next(),
    }));
    app = await listen(expressApp);
  });

  after(async () => {
    endSeason();
    await app.close();
  });

  async function call(method, path, { user, body } = {}) {
    const res = await fetch(`${app.url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(user ? { "x-user-id": user } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it("seasonal current is the live season, not a spring festival", async () => {
    const empty = await call("GET", "/api/world/sim/seasonal/current");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.season, null);
    assert.equal(empty.body.activeEvent, null);
    assert.equal(empty.body.monthlyChallenge, null);
    assert.equal(empty.body.reason, "no_active_season");
    assert.equal(JSON.stringify(empty.body).includes("Spring Engineering"), false);
    assert.equal(JSON.stringify(empty.body).includes("Bridge Builder"), false);

    const started = startSeason({ name: "Harvest", theme: "fields" });
    const live = await call("GET", "/api/world/sim/seasonal/current");
    assert.equal(live.body.season.name, "Harvest");
    assert.equal(live.body.activeEvent.name, "Harvest");
    assert.equal(live.body.activeEvent.id, started.id);
    assert.equal(live.body.activeEvent.source, "season");
    assert.equal(getCurrentSeason().name, "Harvest");
  });

  it("feature flags, brain status, search, graph, and audit log refuse", async () => {
    const flags = await call("GET", "/api/world/sim/feature-flags");
    assert.equal(flags.status, 501);
    assert.equal(flags.body.reason, "flags_not_wired");
    assert.equal(flags.body.flags, undefined);

    const brains = await call("GET", "/api/world/sim/ai/status");
    assert.equal(brains.status, 501);
    assert.equal(brains.body.reason, "no_brain_telemetry");
    assert.equal(JSON.stringify(brains.body).includes("18420"), false);

    const missing = await call("POST", "/api/world/sim/search/semantic", { body: {} });
    assert.equal(missing.status, 400);
    const search = await call("POST", "/api/world/sim/search/semantic", { body: { query: "library" } });
    assert.equal(search.status, 501);
    assert.equal(search.body.reason, "search_not_wired");
    assert.equal(JSON.stringify(search.body).includes("Riverside"), false);

    const graph = await call("POST", "/api/world/sim/knowledge/query", { body: { startId: "dtu-1" } });
    assert.equal(graph.status, 501);
    assert.equal(graph.body.reason, "graph_not_wired");

    const audit = await call("GET", "/api/world/sim/audit-log", { user: "user-a" });
    assert.equal(audit.status, 501);
    assert.equal(audit.body.reason, "no_audit_log");
    assert.equal(JSON.stringify(audit.body).includes("user-1042"), false);
  });

  it("settings and accessibility are the caller's saved values", async () => {
    const absent = await call("GET", "/api/world/sim/settings/user-a", { user: "user-a" });
    assert.equal(absent.status, 501);
    assert.equal(absent.body.reason, "no_saved_settings");
    assert.equal(JSON.stringify(absent.body).includes("medium"), false);

    const other = await call("GET", "/api/world/sim/settings/user-a", { user: "user-b" });
    assert.equal(other.status, 403);

    const saved = await call("POST", "/api/world/sim/settings/user-a", {
      user: "user-a",
      body: { graphics: "low", audio: { master: 0.2 } },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.graphics, "low");
    assert.equal(saved.body.settings.audio.master, 0.2);

    const again = await call("GET", "/api/world/sim/settings/user-a", { user: "user-a" });
    assert.equal(again.body.settings.graphics, "low");

    const access = await call("GET", "/api/world/sim/accessibility/user-a", { user: "user-a" });
    assert.equal(access.status, 501);
    const wrote = await call("POST", "/api/world/sim/accessibility/user-a", {
      user: "user-a",
      body: { reducedMotion: true, textScale: 1.4 },
    });
    assert.equal(wrote.body.settings.reducedMotion, true);
    const read = await call("GET", "/api/world/sim/accessibility/user-a", { user: "user-a" });
    assert.equal(read.body.settings.textScale, 1.4);
    assert.equal(read.body.settings.subtitlesEnabled, undefined);
  });
});
