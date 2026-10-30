/**
 * 56-schema tail — behaviour tests (MCP Addendum 7 §3 remainder;
 * the lane's post-ship scoped sweep is the live acceptance, these
 * tests pin the same criteria in-repo).
 *
 * Every one of the 56 tools whose inputSchema stayed empty after the
 * discovery fixes (#1817) ends this pass in exactly one disposition:
 *
 * DERIVE (7) — in-repo evidence names an argument an in-repo caller
 * actually passes, so the schema publishes it (optional; organ
 * schemas keep additionalProperties: true, so an unlisted organ arg
 * is never rejected client-side):
 *   opportunity_scan, initiative_compose, research_filter,
 *   experience_compress, experience_distill — { since_minutes },
 *   passed by lib/mission-templates.js (60 / 1440 / 120 / 1440 /
 *   1440 minutes);
 *   incident_history — { limit }, passed by lib/mission-templates.js
 *   (10);
 *   trace_root_cause — { trace_id }, named by the capability
 *   registry in domains/trace-fabric.js ("For a given trace_id,
 *   find originating event + walk parent_trace_id chain").
 *
 * VERIFIED-TRUTHFUL (49) — the handler was read and genuinely reads
 * no arguments, so the empty schema stays and is pinned by name
 * below: the 14 in-repo handlers (brainStatus, lensList,
 * federationPeers, schemaStatus, podStatus, reflectStats,
 * reflectRescan, vaultStats, dilaStatus, dilaSkillList, dilaRepair,
 * dhtpStats, dtuRetrievalEval, and conkay_ir_schema's bridge handler,
 * which consumes only internal actor args) have no args reads at
 * all; the 35 organ forwarders read none either, every in-repo
 * caller passes {}, and no record (lane verdict error contracts,
 * capability registries, published descriptions) names a field.
 *
 * Boundaries pinned here: the tier census is untouched (99 real /
 * 3 local / 25 anonymous of 127), no tool gained a required argument
 * in this pass, and validation still fires exactly where it did.
 *
 * Run: node --test server/tests/mcp-schema-tail.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_TOOLS, callMCPTool, validateMcpToolArgs } from "../lib/mcp-tools.js";
import { MCP_TOOLS_LOCAL_OR_REAL_AUTH } from "../lib/mcp-local-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, "../server.js"), "utf8");

function toolDef(name) {
  const t = MCP_TOOLS.find((x) => x.name === name);
  assert.ok(t, `${name} definition exists`);
  return t;
}
function props(name) {
  return toolDef(name).inputSchema?.properties || {};
}

const DERIVED = {
  opportunity_scan: ["since_minutes"],
  initiative_compose: ["since_minutes"],
  research_filter: ["since_minutes"],
  experience_compress: ["since_minutes"],
  experience_distill: ["since_minutes"],
  incident_history: ["limit"],
  trace_root_cause: ["trace_id"],
};

const VERIFIED_TRUTHFUL = [
  // in-repo handlers — read directly, no args reads
  "brain_status", "lens_list", "conkay_ir_schema", "federation_peers",
  "schema_status", "pod_status", "reflect_stats", "reflect_rescan",
  "vault_stats", "dila_status", "dila_skill_list", "dila_repair",
  "dhtp_stats", "dtu_retrieval_eval",
  // organ forwarders — no caller passes args, no record names a field
  "browser_check_coins", "browser_check_incidents", "browser_check_rate_limits",
  "sentinel_watch", "sentinel_review_alerts", "sentinel_health_snapshot", "sentinel_gate_diff",
  "trace_record", "trace_backfill",
  "incident_active", "incident_classify", "incident_recover",
  "research_invoke", "research_findings", "research_pending",
  "proactive_predict", "proactive_calibration",
  "economic_snapshot", "economic_budget", "economic_pnl", "economic_attribution", "economic_check",
  "capability_mine", "capability_list_patterns", "capability_generate_template",
  "a2a_send", "a2a_list_routes", "a2a_check_delivery",
  "experience_consolidate", "experience_list_memories", "experience_stats",
  "concordia_assemble", "concordia_verify", "concordia_demonstrate", "concordia_list_assemblies",
];

describe("56-schema tail", () => {
  it("the tail is fully accounted: 7 derived + 49 verified-truthful = the 56 of Addendum 7 §3", () => {
    assert.equal(Object.keys(DERIVED).length, 7);
    assert.equal(VERIFIED_TRUTHFUL.length, 49);
    const empty = MCP_TOOLS.filter((t) => Object.keys(t.inputSchema?.properties || {}).length === 0);
    assert.equal(empty.length, 49, "empty-schema count falls by exactly the derived set (56 → 49)");
    assert.deepEqual(empty.map((t) => t.name).sort(), [...VERIFIED_TRUTHFUL].sort(),
      "the remaining empty schemas are exactly the verified-truthful list, by name");
  });

  it("derived schemas publish the caller-evidenced args, optional, organ-open", () => {
    for (const [name, fields] of Object.entries(DERIVED)) {
      const def = toolDef(name);
      for (const f of fields) assert.ok(props(name)[f], `${name} publishes ${f}`);
      assert.equal(def.inputSchema.additionalProperties, true, `${name} never rejects an unlisted organ arg`);
      assert.deepEqual(def.inputSchema.required || [], [], `${name} gained no required argument`);
      assert.equal(validateMcpToolArgs(name, {}), null, `${name} with {} is not a validation error`);
    }
    assert.equal(props("opportunity_scan").since_minutes.type, "integer");
    assert.equal(props("incident_history").limit.type, "integer");
    assert.equal(props("trace_root_cause").trace_id.type, "string");
  });

  it("verified-truthful tools keep empty schemas and validate clean on {}", () => {
    for (const name of VERIFIED_TRUTHFUL) {
      assert.deepEqual(props(name), {}, `${name} stays empty (handler read: no args)`);
      assert.equal(validateMcpToolArgs(name, {}), null, `${name} with {} is not a validation error`);
    }
  });

  it("in-repo verified-truthful handlers still execute on {} (no behaviour change)", async () => {
    for (const name of ["dhtp_stats", "reflect_stats", "brain_status", "pod_status"]) {
      const r = await callMCPTool(null, name, {});
      assert.equal(r.ok, true, `${name} executes on {} as before`);
    }
  });

  it("boundaries: tier census untouched (99 real / 3 local / 25 anonymous of 127)", () => {
    const start = SERVER_SRC.indexOf("const MCP_TOOLS_REQUIRE_REAL_AUTH = new Set([");
    assert.ok(start >= 0);
    const block = SERVER_SRC.slice(start, SERVER_SRC.indexOf("]);", start));
    const realSet = new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
    const counts = { real: 0, local: 0, anonymous: 0 };
    for (const t of MCP_TOOLS) {
      counts[realSet.has(t.name) ? "real" : MCP_TOOLS_LOCAL_OR_REAL_AUTH.has(t.name) ? "local" : "anonymous"]++;
    }
    assert.equal(MCP_TOOLS.length, 127);
    assert.deepEqual(counts, { real: 99, local: 3, anonymous: 25 });
  });

  it("boundaries: validation still fires where it did before the tail pass", async () => {
    assert.deepEqual(await callMCPTool(null, "dhtp_detect", {}), { ok: false, error: "prompt is required" });
    assert.deepEqual(await callMCPTool(null, "dtu_search", {}), { ok: false, error: "query is required" });
    assert.deepEqual(await callMCPTool(null, "not_a_tool", {}), { ok: false, error: "Unknown tool: not_a_tool" });
  });
});
