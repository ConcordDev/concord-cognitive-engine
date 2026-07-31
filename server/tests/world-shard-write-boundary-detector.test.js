// tests/world-shard-write-boundary-detector.test.js
//
// Bidirectional pin: a route or scope:"global" heartbeat writing to a
// PER_WORLD_WRITE_TABLES table must be flagged; the same code writing to a
// user-global table (not in the set) must NOT be flagged.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runWorldShardWriteBoundaryDetector,
  findFunctionBody,
} from "../lib/detectors/world-shard-write-boundary-detector.js";

const PROTOCOL_SRC = `
export const PER_WORLD_WRITE_TABLES = Object.freeze(new Set([
  "world_npcs",
  "city_presence",
]));
`;

async function tmpRepo({ routeFiles = {}, serverJs = "", emergentFiles = {} }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wswb-"));
  await mkdir(path.join(dir, "server", "lib"), { recursive: true });
  await mkdir(path.join(dir, "server", "routes"), { recursive: true });
  await mkdir(path.join(dir, "server", "emergent"), { recursive: true });
  await writeFile(path.join(dir, "server", "lib", "world-shard-protocol.js"), PROTOCOL_SRC, "utf8");
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  for (const [name, content] of Object.entries(routeFiles)) {
    await writeFile(path.join(dir, "server", "routes", name), content, "utf8");
  }
  for (const [name, content] of Object.entries(emergentFiles)) {
    await writeFile(path.join(dir, "server", "emergent", name), content, "utf8");
  }
  return dir;
}

describe("world-shard-write-boundary detector — pure helpers", () => {
  it("finds a function-declaration body by identifier", () => {
    const blob = `function runFoo(a,b) { db.prepare("INSERT INTO world_npcs (id) VALUES (?)").run(a); }`;
    const found = findFunctionBody(blob, "runFoo");
    assert.ok(found && found.body.includes("world_npcs"));
  });
});

describe("world-shard-write-boundary detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS a route writing to a per-world table", async () => {
    const routeFiles = {
      "worlds.js": `router.post("/x", (req,res) => { db.prepare("UPDATE world_npcs SET hp = ? WHERE id = ?").run(1, 2); });`,
    };
    dir = await tmpRepo({ routeFiles });
    const r = await runWorldShardWriteBoundaryDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "world_shard_write_from_route");
    assert.ok(hit, "route write to world_npcs must be flagged");
    assert.equal(hit.evidence.table, "world_npcs");
    assert.equal(hit.severity, "high");
  });

  it("does NOT flag a route writing to a user-global table", async () => {
    const routeFiles = {
      "users.js": `router.post("/x", (req,res) => { db.prepare("UPDATE users SET name = ? WHERE id = ?").run("a", 2); });`,
    };
    dir = await tmpRepo({ routeFiles });
    const r = await runWorldShardWriteBoundaryDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "world_shard_write_from_route");
    assert.equal(hit, undefined, "users is not a per-world table");
  });

  it("FLAGS a scope:'global' heartbeat handler writing to a per-world table", async () => {
    const serverJs = `
registerHeartbeat("npc-travel-cycle", { frequency: 60, handler: runNpcTravelCycle, scope: "global" });
`;
    const emergentFiles = {
      "npc-travel.js": `function runNpcTravelCycle() { db.prepare("INSERT INTO city_presence (id) VALUES (?)").run(1); }`,
    };
    dir = await tmpRepo({ serverJs, emergentFiles });
    const r = await runWorldShardWriteBoundaryDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "world_shard_write_from_global_heartbeat");
    assert.ok(hit, "global-scope heartbeat writing city_presence must be flagged");
    assert.equal(hit.evidence.heartbeat, "npc-travel-cycle");
    assert.equal(hit.evidence.table, "city_presence");
  });

  it("does NOT flag a scope:'world' heartbeat handler writing to a per-world table", async () => {
    const serverJs = `
registerHeartbeat("per-world-thing", { frequency: 60, handler: runPerWorldThing, scope: "world" });
`;
    const emergentFiles = {
      "per-world-thing.js": `function runPerWorldThing() { db.prepare("INSERT INTO city_presence (id) VALUES (?)").run(1); }`,
    };
    dir = await tmpRepo({ serverJs, emergentFiles });
    const r = await runWorldShardWriteBoundaryDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "world_shard_write_from_global_heartbeat");
    assert.equal(hit, undefined, "scope:'world' heartbeats are the correct place for per-world writes");
  });
});
