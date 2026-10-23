// Pins the 2026-10-23 fix for live row vlt_mv5rrmr8_vztrld6i: an MCP client
// wrote vault tags [..., null, "pass:undefined", "fail:undefined"], and the
// NPC knowledge bridge then threw "Cannot read properties of null (reading
// 'startsWith')" on that row every tick, so the engineering knowledge in it
// never reached any NPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanVaultTags, vaultWrite } from "../lib/mcp-tools.js";
import { runNpcKnowledgeBridge } from "../lib/npc-knowledge-bridge.js";

const LIVE_TAGS = ["engineering-workflow", "engineering", "conkay", "lapsplice", null, "pass:undefined", "fail:undefined"];

test("cleanVaultTags drops non-strings and stringified undefined/null values", () => {
  assert.deepEqual(cleanVaultTags(LIVE_TAGS), ["engineering-workflow", "engineering", "conkay", "lapsplice"]);
  assert.deepEqual(cleanVaultTags([" a ", "a", "", 3, undefined, "undefined", "null", "pass:3", "domain:null"]), ["a", "pass:3"]);
  assert.deepEqual(cleanVaultTags("engineering"), []);
  assert.deepEqual(cleanVaultTags(undefined), []);
});

test("vaultWrite stores only clean tags", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, body_json TEXT, tags_json TEXT,
    visibility TEXT, tier TEXT, type TEXT, creator_id TEXT, content TEXT, status TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  const r = await vaultWrite(db, { namespace: "engineering-workflow", vault_type: "report", title: "Lap-splice", content: "ok", tags: LIVE_TAGS });
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = db.prepare("SELECT tags_json, body_json FROM dtus").get();
  const tags = JSON.parse(row.tags_json);
  assert.ok(tags.every((t) => typeof t === "string" && !/undefined|null/.test(t)), row.tags_json);
  assert.ok(tags.includes("engineering"));
  assert.deepEqual(JSON.parse(row.body_json).tags, ["engineering-workflow", "engineering", "conkay", "lapsplice"]);
});

test("the bridge still mirrors a row that already holds a null tag", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, body_json TEXT, tags_json TEXT,
      visibility TEXT DEFAULT 'public', created_at TEXT);
    CREATE TABLE npc_knowledge (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, role TEXT NOT NULL, dtu_id TEXT NOT NULL,
      summary TEXT NOT NULL, domain TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(world_id, role, dtu_id));
  `);
  db.prepare("INSERT INTO dtus (id, title, body_json, tags_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    "vlt_live", "Lap-splice bracket", JSON.stringify({ content: "Lap-splice bracket passes bolt screening" }),
    JSON.stringify(["vault", ...LIVE_TAGS, "domain:structures"]), "2026-10-12T21:33:52.000Z",
  );
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a);
  try { runNpcKnowledgeBridge({ state: {}, db }); } finally { console.warn = warn; }
  assert.deepEqual(warned.filter((a) => String(a[0]).includes("row failed")), []);
  const rows = db.prepare("SELECT role, domain FROM npc_knowledge WHERE dtu_id = 'vlt_live'").all();
  assert.deepEqual(rows, [{ role: "engineer", domain: "structures" }]);
});
