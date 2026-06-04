// Regression guard for the world-shard travel wiring.
//
// Phase I sharding was dead-wired for a long time: a shard-aware copy of
// POST /api/worlds/travel lived as an inline app.post in server.js, but it was
// registered AFTER the worlds router mount, so Express never reached it. With
// CONCORD_SHARD_WORLDS=true the parent governor delegates ALL scope:'world'
// heartbeats to per-world shards — so if the LIVE travel route doesn't call
// ensureWorldActive, no shard spawns and every world silently stops simulating.
//
// These are source-level invariants (cheap, deterministic) that fail if anyone:
//   1. removes shard activation from the live router travel path, or
//   2. re-introduces a second travel route in server.js that would shadow it.
// Behavioural coverage of ensureWorldActive itself lives in
// world-shard-on-demand.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worldsRouterSrc = readFileSync(path.join(__dirname, "..", "routes", "worlds.js"), "utf8");
const serverSrc = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("live worlds router imports the shard-activation helpers", () => {
  assert.match(worldsRouterSrc, /import\s*\{[^}]*\bensureWorldActive\b[^}]*\}\s*from\s*["']\.\.\/lib\/world-shard-manager\.js["']/);
  assert.match(worldsRouterSrc, /import\s*\{\s*shardingEnabled\s*\}\s*from\s*["']\.\.\/lib\/world-shard-protocol\.js["']/);
});

test("the /travel handler activates the destination world's shard", () => {
  // The router's POST /travel must call ensureWorldActive (gated on
  // shardingEnabled) so traveling spawns the world's worker.
  const travelIdx = worldsRouterSrc.indexOf('router.post("/travel"');
  assert.ok(travelIdx !== -1, "router.post(\"/travel\") handler must exist");
  // ensureWorldActive must appear after the /travel handler opens (within the
  // file region that is the travel handler — before the next route is unlikely
  // to matter, but we anchor on proximity to keep it robust).
  const after = worldsRouterSrc.slice(travelIdx, travelIdx + 2000);
  assert.match(after, /shardingEnabled\(\)/, "/travel must gate on shardingEnabled()");
  assert.match(after, /ensureWorldActive\(/, "/travel must call ensureWorldActive()");
  assert.match(after, /markWorldUserCount\(/, "/travel must increment the world user count");
});

test("server.js does NOT define a shadowing inline travel route", () => {
  // The dead inline app.post("/api/worlds/travel", ...) was removed. If it
  // returns, it will sit after the router mount and either shadow the router
  // (Express first-match) or duplicate the handler — either way a regression.
  assert.ok(
    !/app\.post\(\s*["'`]\/api\/worlds\/travel["'`]/.test(serverSrc),
    "server.js must not register its own /api/worlds/travel route (the worlds router owns it)"
  );
});

test("move handler keeps an active shard warm", () => {
  // Continuous in-world movement must refresh shard activity so the idle
  // teardown doesn't reap a shard out from under an active player.
  const moveIdx = worldsRouterSrc.indexOf('router.post("/:worldId/move"');
  assert.ok(moveIdx !== -1, "move route must exist");
  const after = worldsRouterSrc.slice(moveIdx, moveIdx + 1200);
  assert.match(after, /recordWorldActivity\(/, "move handler must call recordWorldActivity() under sharding");
});
