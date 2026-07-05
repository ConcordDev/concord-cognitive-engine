// Verification-audit fix — pinning test for a duplicate-handler-race
// finding in server/routes/worlds.js: GET /:worldId/emergents was
// registered twice. Express only ever dispatches the first-registered
// handler, so the live behavior was `{ ok:true, emergents }` with no
// `bosses` field and no auth — the second registration's "conscious
// world-boss NPCs" enrichment never shipped. The two were merged into a
// single handler (bosses enrichment kept, no-auth access kept to match
// what was previously live).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import createWorldsRouter from "../routes/worlds.js";

let db, app, server, baseUrl;

before(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  await runMigrations(db);

  db.prepare(
    `INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, ?)`
  ).run("test-world", "Test World", "fantasy");

  db.prepare(`
    INSERT INTO world_npcs (id, world_id, npc_type, archetype, is_conscious, is_dead, level, state, current_location)
    VALUES (?, ?, 'boss', 'dragon-lord', 1, 0, 42, ?, ?)
  `).run("boss-npc-1", "test-world", JSON.stringify({ name: "Ashfang" }), JSON.stringify({ x: 1, y: 2, z: 3 }));

  const router = createWorldsRouter({ requireAuth: (req, res, next) => next(), db });
  app = express();
  app.use(express.json());
  app.use("/api/worlds", router);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe("GET /api/worlds/:worldId/emergents — merged duplicate registration", () => {
  it("is registered exactly once in source", () => {
    const src = fs.readFileSync(new URL("../routes/worlds.js", import.meta.url), "utf8");
    const matches = src.match(/router\.get\(\s*["']\/:worldId\/emergents["']/g) || [];
    assert.equal(matches.length, 1, "expected exactly one GET /:worldId/emergents registration");
  });

  it("returns both emergents and the bosses enrichment (previously only reachable via the dead duplicate)", async () => {
    const res = await fetch(`${baseUrl}/api/worlds/test-world/emergents`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.emergents));
    assert.ok(Array.isArray(body.bosses), "bosses field must be present — this was the dead duplicate's enrichment");
    assert.equal(body.bosses.length, 1);
    assert.equal(body.bosses[0].name, "Ashfang");
    assert.equal(body.bosses[0].role, "world_boss");
    assert.equal(body.total, body.emergents.length + body.bosses.length);
  });

  it("does not require auth (matches the previously-live no-auth behavior)", async () => {
    const res = await fetch(`${baseUrl}/api/worlds/test-world/emergents`);
    assert.equal(res.status, 200);
  });
});
