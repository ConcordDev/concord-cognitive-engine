/**
 * Walk → Registry Merge Pilot — behaviour tests (MCP Platform lane;
 * founder directive 2026-11-06, option C; distillation record
 * walk-registry-merge-pilot-distillation-record-2026-11-06.md).
 *
 * Pins, in the enrichment-ON default arm:
 *  - the overlay enriches exactly the distilled entry set (133 reflected
 *    macro descriptions, in the 15 overlay domains) and nothing else;
 *  - an enriched description carries the walk-verified behaviour + args
 *    inside the 500-char discipline, and its schema description carries
 *    the verified argument shape instead of the generic fallback text;
 *  - a pilot macro with NO distilled entry keeps the untouched fallback;
 *  - walk_guide is registered Tier-1-style (in neither enforcement set —
 *    the census pins live in mcp-discovery-fixes / mcp-schema-tail) and
 *    answers lens + macro lookups with provenance, refuses unknown
 *    lenses, and validates its anyOf requirement through callMCPTool.
 *
 * The OFF arm (CONCORD_WALK_OVERLAY=off: 0 enriched, census 127,
 * walk_guide unregistered) is exercised by the ship filing's smoke runs,
 * not here — this suite runs in the repo's default environment.
 *
 * Run: node --test server/tests/mcp-walk-registry-pilot.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_TOOLS, callMCPTool } from "../lib/mcp-tools.js";
import { REFLECTED_TOOLS } from "../lib/macro-reflection.js";
import { walkGuideLookup, walkGuideLenses } from "../lib/walk-registry.js";

const OVERLAY_DOMAINS = ["answers", "atlas", "bridge", "hr", "hypothesis", "ingest", "invariant", "linguistics", "meditation", "neuro", "observe", "physics", "quantum", "robotics", "science"];
const GENERIC_SCHEMA = "Arbitrary arguments. See macro source for expected shape.";

function reflected(name) {
  const t = REFLECTED_TOOLS.find((x) => x.name === name);
  assert.ok(t, `${name} is reflected`);
  return t;
}

describe("walk overlay in reflection", () => {
  it("enriches exactly the 133 distilled entries, all inside the overlay domains", () => {
    const enriched = REFLECTED_TOOLS.filter(
      (t) => t._meta?.kind === "macro" && t.inputSchema.description.startsWith("Arguments for macro.")
    );
    assert.equal(enriched.length, 133);
    for (const t of enriched) assert.ok(OVERLAY_DOMAINS.includes(t._meta.domain), `${t.name} in an overlay domain`);
  });

  it("an enriched description carries verified behaviour + args within the 500-char cap", () => {
    const t = reflected("macro.neuro.statisticalTest");
    assert.match(t.description, /5\.1534/);
    assert.match(t.description, /Args: two sample arrays\./);
    assert.ok(t.description.length <= 500);
    assert.match(t.inputSchema.description, /Arguments for macro\.neuro\.statisticalTest: two sample arrays\./);
    assert.ok(!t.inputSchema.description.includes(GENERIC_SCHEMA));
  });

  it("a pilot macro with no distilled entry keeps the untouched fallback", () => {
    const t = reflected("macro.answers.question-delete");
    assert.equal(t.description, "[server/domains/answers.js] question-delete action for the answers domain.");
    // Baseline shape: the permissive schema's description is the macro's
    // own source description, with no verified argument shape attached.
    assert.equal(t.inputSchema.description, "question-delete action for the answers domain.");
    assert.ok(!t.inputSchema.description.startsWith("Arguments for macro."));
  });

  it("a zero-overlay pilot domain (cooking) gains no enriched descriptions", () => {
    const cooking = REFLECTED_TOOLS.filter((t) => t._meta?.kind === "macro" && t._meta.domain === "cooking");
    assert.ok(cooking.length > 0);
    assert.ok(cooking.every((t) => !t.inputSchema.description.startsWith("Arguments for macro.")));
  });
});

describe("walk_guide tool", () => {
  it("is registered with a lens/macro anyOf schema", () => {
    const def = MCP_TOOLS.find((t) => t.name === "walk_guide");
    assert.ok(def, "walk_guide definition exists");
    assert.deepEqual(def.inputSchema["x-anyOfRequired"], [["lens", "macro"]]);
  });

  it("serves all 20 pilot lens entries", () => {
    assert.equal(walkGuideLenses().length, 20);
  });

  it("lens lookup returns the verified core, provenance and overlay entries", async () => {
    const r = await callMCPTool(null, "walk_guide", { lens: "bridge" });
    assert.equal(r.ok, true);
    assert.equal(r.overlayEntries.length, 22);
    assert.equal(r.provenance.source, "lens-reviews/bridge.md");
    assert.ok(r.guide.includes("first_name"));
  });

  it("macro lookup returns the distilled entry with its argument shape", async () => {
    const r = await callMCPTool(null, "walk_guide", { macro: "macro.answers.question-ask" });
    assert.equal(r.ok, true);
    assert.match(r.overlay.verifiedBehaviour, /title must be at least 8 characters/);
    assert.match(r.overlay.args, /title/);
  });

  it("macro lookup for an undistilled macro says so instead of inventing behaviour", async () => {
    const r = await callMCPTool(null, "walk_guide", { macro: "macro.paper.paper-capture" });
    assert.equal(r.ok, true);
    assert.equal(r.overlay.verifiedBehaviour, null);
    assert.match(r.overlay.note, /No overlay entry was distilled/);
  });

  it("unknown lens is refused with the pilot list; missing args fail validation", async () => {
    const r = walkGuideLookup({ lens: "not-a-lens" });
    assert.equal(r.ok, false);
    assert.equal(r.pilotLenses.length, 20);
    assert.deepEqual(await callMCPTool(null, "walk_guide", {}), { ok: false, error: "lens or macro is required" });
  });
});
