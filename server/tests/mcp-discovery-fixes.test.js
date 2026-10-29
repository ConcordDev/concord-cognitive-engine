/**
 * Discovery fixes — behaviour tests (MCP lane spec
 * discovery-fixes-spec-2026-10-28; the lane's post-ship scoped sweep is
 * the live acceptance, these tests pin the same criteria in-repo).
 *
 * §1 lens_list / lens_manifest: honest DTU-corpus relabel; manifest
 *    dtuCount is a real COUNT(*), sampleSize names the rows returned;
 *    an id outside the registry returns 0/empty, not an error.
 * §2 Tier marking: /mcp/tools computes `auth` from the enforcement sets
 *    (MCP_TOOLS_REQUIRE_REAL_AUTH in server.js + the local-or-real set
 *    in lib/mcp-local-guard.js). The handler's derivation is pinned at
 *    source level; the classification of every one of the 127 tools is
 *    recomputed here from those same sets and checked against the
 *    lane's amended totals (99 real / 3 local / 25 anonymous).
 * §3 Schemas + validation: required-arg validation reads the published
 *    inputSchema and fires inside callMCPTool — dhtp_detect (the case of
 *    record: schema declared `prompt` required, handler executed on {})
 *    now returns the validation error. Ordering gate → validation →
 *    dispatch is pinned on the /mcp/call source: both gate checks stand
 *    before the dispatch call, and validation lives inside the
 *    dispatcher those gates precede.
 * §4 Sentinel trim: loopback endpoint URLs are stripped from
 *    sentinel-shaped payloads; health, online states, models stay.
 *
 * Run: node --test server/tests/mcp-discovery-fixes.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  MCP_TOOLS,
  callMCPTool,
  lensList,
  lensManifest,
  trimInternalEndpointUrls,
  validateMcpToolArgs,
} from "../lib/mcp-tools.js";
import { MCP_TOOLS_LOCAL_OR_REAL_AUTH } from "../lib/mcp-local-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, "../server.js"), "utf8");

function realAuthSet() {
  const start = SERVER_SRC.indexOf("const MCP_TOOLS_REQUIRE_REAL_AUTH = new Set([");
  assert.ok(start >= 0, "real-auth set found in server.js");
  const end = SERVER_SRC.indexOf("]);", start);
  const block = SERVER_SRC.slice(start, end);
  return new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
}
function expectedAuth(name, realSet) {
  return realSet.has(name) ? "real" : MCP_TOOLS_LOCAL_OR_REAL_AUTH.has(name) ? "local" : "anonymous";
}
function toolDef(name) {
  const t = MCP_TOOLS.find((x) => x.name === name);
  assert.ok(t, `${name} definition exists`);
  return t;
}

// ── §1 lens_list / lens_manifest ──────────────────────────────────────

function seedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT, title TEXT, tier TEXT, type TEXT, lens_id TEXT, created_at TEXT)`);
  const ins = db.prepare(`INSERT INTO dtus (id, title, tier, type, lens_id, created_at) VALUES (?, ?, 'regular', 'note', ?, ?)`);
  for (let i = 0; i < 15; i++) ins.run(`dtu-craft-${i}`, `craft ${i}`, "crafting", `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`);
  for (let i = 0; i < 3; i++) ins.run(`dtu-trivia-${i}`, `trivia ${i}`, "trivia", `2026-10-02T00:00:0${i}Z`);
  ins.run("dtu-unknown-0", "unclassified", "unknown", "2026-10-03T00:00:00Z");
  ins.run("dtu-null-0", "no lens", null, "2026-10-03T00:00:01Z");
  return db;
}

describe("lens_list / lens_manifest (§1)", () => {
  it("lens_manifest: dtuCount is the true COUNT(*), sampleSize is the rows returned (crafting sample)", async () => {
    const db = seedDb();
    const r = await lensManifest(db, { lens_id: "crafting" });
    assert.equal(r.ok, true);
    assert.equal(r.dtuCount, 15, "true count for crafting, not the sample length");
    assert.equal(r.sampleSize, 10, "sample is capped at 10 rows");
    assert.equal(r.sample.length, 10);
    db.close();
  });

  it("lens_manifest: a product-lens id outside the registry returns 0/empty, not an error (chat case)", async () => {
    const db = seedDb();
    const r = await lensManifest(db, { lens_id: "chat" });
    assert.equal(r.ok, true);
    assert.equal(r.dtuCount, 0, "0 means no DTUs classified under this id");
    assert.equal(r.sampleSize, 0);
    assert.deepEqual(r.sample, []);
    db.close();
  });

  it("lens_list: counts state their basis; only DTU-holding lens_ids appear", async () => {
    const db = seedDb();
    const r = await lensList(db, {});
    assert.equal(r.ok, true);
    const byId = Object.fromEntries(r.lenses.map((l) => [l.id, l.dtuCount]));
    assert.equal(byId.crafting, 15);
    assert.equal(byId.trivia, 3);
    assert.equal(byId.unknown, undefined, "'unknown' is excluded");
    assert.equal(r.count, r.lenses.length, "count is the number of lens_ids returned");
    assert.equal(r.count, 2);
    assert.equal(r.truncated, false);
    assert.match(r.basis, /at least one DTU/);
    db.close();
  });

  it("lens_list: truncated is true when the top-50 cap binds", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT, title TEXT, tier TEXT, type TEXT, lens_id TEXT, created_at TEXT)`);
    const ins = db.prepare(`INSERT INTO dtus (id, title, tier, type, lens_id, created_at) VALUES (?, 'x', 'regular', 'note', ?, '2026-10-01T00:00:00Z')`);
    for (let i = 0; i < 55; i++) ins.run(`dtu-${i}`, `lens-${i}`);
    const r = await lensList(db, {});
    assert.equal(r.count, 50);
    assert.equal(r.lenses.length, 50);
    assert.equal(r.truncated, true);
    db.close();
  });

  it("descriptions carry the relabel: registry, not the product directory; no actions/schemas promised", () => {
    const list = toolDef("lens_list");
    assert.match(list.description, /DTU classification registry/);
    assert.match(list.description, /not the product lens directory/);
    assert.match(list.description, /truncated/);
    const manifest = toolDef("lens_manifest");
    assert.match(manifest.description, /COUNT\(\*\)/);
    assert.match(manifest.description, /sampleSize/);
    assert.match(manifest.description, /no actions and no schemas/);
    assert.match(manifest.description, /no DTUs classified under this id/);
  });
});

// ── §2 tier marking ───────────────────────────────────────────────────

describe("tier marking (§2)", () => {
  it("/mcp/tools handler computes auth from both enforcement sets at the handler", () => {
    const start = SERVER_SRC.indexOf('app.get("/mcp/tools"');
    assert.ok(start >= 0);
    const handler = SERVER_SRC.slice(start, SERVER_SRC.indexOf('app.post("/mcp/call"', start));
    assert.match(handler, /MCP_TOOLS_REQUIRE_REAL_AUTH\.has\(t\.name\)/);
    assert.match(handler, /MCP_TOOLS_LOCAL_OR_REAL_AUTH\.has\(t\.name\)/);
    assert.match(handler, /"real"/);
    assert.match(handler, /"local"/);
    assert.match(handler, /"anonymous"/);
    assert.match(SERVER_SRC, /import \{ MCP_TOOLS_LOCAL_OR_REAL_AUTH \} from "\.\/lib\/mcp-local-guard\.js";/);
  });

  it("every tool classifies to the lane's amended totals: 99 real / 3 local / 25 anonymous of 127", () => {
    const realSet = realAuthSet();
    const counts = { real: 0, local: 0, anonymous: 0 };
    for (const t of MCP_TOOLS) counts[expectedAuth(t.name, realSet)]++;
    assert.equal(MCP_TOOLS.length, 127);
    assert.deepEqual(counts, { real: 99, local: 3, anonymous: 25 });
  });

  it("acceptance sample classifications (P0 surfaces, writes, compute, rt_* trio, anonymous-by-design)", () => {
    const realSet = realAuthSet();
    const expect = {
      browser_check_coins: "real", vault_read: "real", a2a_list_routes: "real", browser_check_rate_limits: "real",
      vault_write: "real", dila_dispatch: "real", opportunity_approve: "real",
      dhtp_detect: "real", csl_classify: "real", breakdown_build: "real",
      rt_tick: "local", rt_drives: "local", rt_tick_history: "local",
      reflect_search: "anonymous", lens_list: "anonymous", dtu_search: "anonymous",
      tool_compile_universe: "anonymous", browser_check_incidents: "anonymous",
      sentinel_health_snapshot: "anonymous", sentinel_watch: "anonymous",
    };
    for (const [name, tier] of Object.entries(expect)) {
      assert.equal(expectedAuth(name, realSet), tier, `${name} → ${tier}`);
    }
  });
});

// ── §3 schemas + validation ───────────────────────────────────────────

describe("inputSchemas + validation (§3)", () => {
  it("ordering in /mcp/call: real-auth gate, then local guard, then dispatch", () => {
    const start = SERVER_SRC.indexOf('app.post("/mcp/call"');
    assert.ok(start >= 0);
    const route = SERVER_SRC.slice(start, start + 6000);
    const gate = route.indexOf("MCP_TOOLS_REQUIRE_REAL_AUTH.has(tool)");
    const local = route.indexOf("mcpLocalGuardAllows(tool, req)");
    const dispatch = route.indexOf("dispatchMCP(tool");
    assert.ok(gate >= 0 && local > gate && dispatch > local,
      `gate (${gate}) → local guard (${local}) → dispatch (${dispatch})`);
    // Validation itself lives inside callMCPTool, which dispatch reaches
    // only after those gates — gate → validation → dispatch.
    const tools = readFileSync(join(__dirname, "../lib/mcp-tools.js"), "utf8");
    const fnStart = tools.indexOf("export async function callMCPTool");
    const validateAt = tools.indexOf("validateMcpToolArgs(toolName, args)", fnStart);
    const switchAt = tools.indexOf("switch (toolName)", fnStart);
    assert.ok(validateAt > fnStart && switchAt > validateAt, "validation precedes the dispatch switch");
  });

  it("dhtp_detect — the case of record: {} returns the validation error, not an execution", async () => {
    const r = await callMCPTool(null, "dhtp_detect", {});
    assert.deepEqual(r, { ok: false, error: "prompt is required" });
    assert.equal(r.matched, undefined, "the handler did not execute");
  });

  it("dhtp_detect with a prompt dispatches for real", async () => {
    const r = await callMCPTool(null, "dhtp_detect", { prompt: "explain how the vault works" });
    assert.equal(r.ok, true);
    assert.ok("matched" in r, "real handler result shape");
  });

  it("validation fires for the newly-validated siblings, in the handlers' own phrasing", async () => {
    assert.deepEqual(await callMCPTool(null, "breakdown_stitch", {}), { ok: false, error: "dtuIds is required" });
    assert.deepEqual(await callMCPTool(null, "breakdown_decompose", {}), { ok: false, error: "request is required" });
    assert.deepEqual(await callMCPTool(null, "breakdown_dispatch", {}), { ok: false, error: "subtasks is required" });
    assert.deepEqual(await callMCPTool(null, "research_get", {}), { ok: false, error: "id is required" });
    assert.deepEqual(await callMCPTool(null, "lens_manifest", {}), { ok: false, error: "lens_id is required" });
    assert.deepEqual(await callMCPTool(null, "dtu_search", {}), { ok: false, error: "query is required" });
    assert.deepEqual(validateMcpToolArgs("a2a_get_message", {}), { ok: false, error: "id or message_id is required" });
    assert.equal(validateMcpToolArgs("a2a_get_message", { message_id: "m1" }), null);
    assert.equal(validateMcpToolArgs("a2a_get_message", { id: "m1" }), null);
  });

  it("empty string / empty array count as missing; no-required tools and unknown tools are untouched", async () => {
    assert.deepEqual(validateMcpToolArgs("dhtp_detect", { prompt: "   " }), { ok: false, error: "prompt is required" });
    assert.deepEqual(validateMcpToolArgs("dtu_compress", { ids: [] }), { ok: false, error: "ids is required" });
    assert.equal(validateMcpToolArgs("vault_stats", {}), null);
    assert.equal(validateMcpToolArgs("reflect_stats", {}), null);
    assert.equal(validateMcpToolArgs("not_a_tool", {}), null);
    assert.deepEqual(await callMCPTool(null, "not_a_tool", {}), { ok: false, error: "Unknown tool: not_a_tool" });
  });

  it("the derived schemas are published: breakdown family, incident_watch, organ *_get ids, evidence-backed filters", () => {
    assert.deepEqual(toolDef("breakdown_decompose").inputSchema.required, ["request"]);
    assert.deepEqual(toolDef("breakdown_dispatch").inputSchema.required, ["subtasks"]);
    assert.deepEqual(toolDef("breakdown_stitch").inputSchema.required, ["dtuIds"]);
    assert.deepEqual(toolDef("breakdown_build").inputSchema.required, ["request"]);
    assert.ok(toolDef("incident_watch").inputSchema.properties.since_minutes, "incident_watch publishes since_minutes (its in-process handler reads it)");
    for (const name of ["research_get", "opportunity_get", "initiative_get", "experience_get_memory", "trace_lookup", "opportunity_approve", "opportunity_reject", "initiative_validate"]) {
      assert.deepEqual(toolDef(name).inputSchema.required, ["id"], `${name} requires id`);
    }
    for (const name of ["proactive_list_predictions", "a2a_list_messages", "initiative_list", "opportunity_list", "trace_recent"]) {
      assert.ok(Object.keys(toolDef(name).inputSchema.properties).length > 0, `${name} publishes its filters`);
      assert.equal(toolDef(name).inputSchema.additionalProperties, true, `${name} never rejects an unlisted organ arg client-side`);
    }
    // The tools whose handlers genuinely read no args keep truthful
    // empty schemas — they are not padded with invented arguments.
    for (const name of ["vault_stats", "dila_status", "brain_status", "pod_status", "schema_status", "federation_peers", "dhtp_stats", "dtu_retrieval_eval"]) {
      assert.deepEqual(toolDef(name).inputSchema.properties, {}, `${name} reads no args`);
    }
  });
});

// ── §4 sentinel trim ──────────────────────────────────────────────────

describe("sentinel loopback trim (§4)", () => {
  it("loopback endpoint values are stripped; health, online states and models survive", () => {
    const payload = {
      ok: true,
      status: "healthy",
      brains: [
        { name: "conscious", online: true, model: "llama3.1", endpoint: "http://127.0.0.1:11434" },
        { name: "utility", online: false, model: "qwen2.5", endpoint: "http://localhost:11435/v1" },
      ],
      note: "utility brain slow via 127.0.0.1:11435 today",
      links: ["http://127.0.0.1:11434/api/tags", "https://status.example.com/health"],
      compressionPct: 42,
    };
    const out = trimInternalEndpointUrls(payload);
    const flat = JSON.stringify(out);
    assert.ok(!/127\.0\.0\.1/.test(flat), "no 127.0.0.1 anywhere in the trimmed payload");
    assert.ok(!/localhost/.test(flat), "no localhost anywhere in the trimmed payload");
    assert.equal(out.status, "healthy");
    assert.equal(out.brains[0].name, "conscious");
    assert.equal(out.brains[0].online, true);
    assert.equal(out.brains[0].model, "llama3.1");
    assert.equal(out.brains[0].endpoint, undefined, "loopback endpoint value dropped");
    assert.equal(out.brains[1].online, false);
    assert.equal(out.brains[1].model, "qwen2.5");
    assert.match(out.note, /\[internal endpoint\]/);
    assert.deepEqual(out.links, ["https://status.example.com/health"], "public links survive; loopback entries removed");
    assert.equal(out.compressionPct, 42);
  });

  it("the trim is wired to exactly the two anonymous sentinel surfaces", () => {
    const tools = readFileSync(join(__dirname, "../lib/mcp-tools.js"), "utf8");
    const start = tools.indexOf("async function sentinelOrganCall");
    const block = tools.slice(start, tools.indexOf("async function traceFabricCall", start));
    assert.match(block, /sentinel_watch/);
    assert.match(block, /sentinel_health_snapshot/);
    assert.match(block, /trimInternalEndpointUrls\(result\)/);
  });
});
