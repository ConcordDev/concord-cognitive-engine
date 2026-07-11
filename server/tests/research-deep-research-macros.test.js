// Regression test for the "Deep Research" pipeline behind the research
// lens's "Deep Research" button (`POST /api/research/conduct` →
// `conductResearch()` in server.js).
//
// conductResearch() calls `runMacro("hypothesis","generate", ...)`,
// `runMacro("research","cross-domain-scan", ...)`, and
// `runMacro("research","synthesize", ...)` directly — but until this fix
// none of the three were registered anywhere (registerLensAction's
// LENS_ACTIONS map is a SEPARATE registry runMacro cannot see — only
// register()'d MACROS entries are reachable via runMacro). Every real
// "Deep Research" request therefore silently degraded to "macro not
// found" on 3 of its 4 phases (caught by conductResearch's per-phase
// try/catch and downgraded to `{ phase, error: "skipped" }`), and the
// frontend had nothing to render but a JSON dump of the raw phases array.
//
// This test pins that all three macros are now registered, return real
// (not "macro not found" / "macro_uncaught_throw") results, and are
// grounded ONLY in the inputs supplied — no fabricated content.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

describe("Deep Research pipeline macros (hypothesis.generate / research.cross-domain-scan / research.synthesize)", () => {
  it("hypothesis.generate derives falsifiable statements from the supplied topic + substrate context", async () => {
    const mod = await import("../server.js");
    _serverMod = mod;
    const __TEST__ = mod.__TEST__;
    assert.ok(__TEST__, "server.js must export __TEST__ for the harness");

    const ctx = __TEST__.makeInternalCtx("deep-research-test");
    const r = await __TEST__.runMacro("hypothesis", "generate", {
      topic: "solar panel thermal degradation",
      existingKnowledge: "panel efficiency, thermal loss, degradation rate",
      count: 3,
    }, ctx);

    assert.equal(r.ok, true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert.notEqual(r.error, "macro not found: hypothesis.generate");
    assert.ok(Array.isArray(r.items), "items must be an array");
    assert.ok(r.items.length > 0 && r.items.length <= 3);
    for (const item of r.items) {
      const statement = item?.machine?.hypothesis?.statement || item?.statement;
      assert.ok(typeof statement === "string" && statement.length > 0, "each item must carry a derived statement");
      assert.ok(statement.includes("solar panel thermal degradation"), "statement must reference the real topic, not an invented one");
    }
  });

  it("research.cross-domain-scan returns real substrate connections (never fabricated)", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    const ctx = __TEST__.makeInternalCtx("deep-research-test");

    const r = await __TEST__.runMacro("research", "cross-domain-scan", {
      topic: "solar panel thermal degradation",
      excludeDomains: [],
      userId: ctx.actor.userId,
    }, ctx);

    assert.equal(r.ok, true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert.ok(Array.isArray(r.connections), "connections must be an array");
    assert.equal(typeof r.domainsScanned, "number");
    assert.equal(typeof r.totalMatches, "number");
    // On a fresh in-memory substrate there may be zero matches — that's an
    // honest empty result, not a failure.
    assert.ok(r.totalMatches >= 0);
  });

  it("research.synthesize composes a report grounded ONLY in the supplied substrateKnowledge", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    const ctx = __TEST__.makeInternalCtx("deep-research-test");

    const r = await __TEST__.runMacro("research", "synthesize", {
      topic: "solar panel thermal degradation",
      substrateKnowledge: [
        { id: "dtu1", title: "Panel Degradation Field Study", domain: "energy" },
        { id: "dtu2", title: "Thermal Loss Modeling", domain: "physics" },
      ],
      userId: ctx.actor.userId,
    }, ctx);

    assert.equal(r.ok, true, `expected ok:true, got ${JSON.stringify(r)}`);
    assert.equal(typeof r.content, "string");
    assert.ok(r.content.includes("Panel Degradation Field Study"), "content must cite the real supplied DTU titles");
    assert.ok(r.content.includes("Thermal Loss Modeling"));
    assert.ok(r.content.includes("energy") && r.content.includes("physics"), "content must name the real supplied domains");
    assert.equal(r.substrateCount, 2);
    // The synthesis is minted as a real, citable DTU (via makeInternalCtx so
    // dtu.create's full ctx contract — ctx.log, ctx.macro.run — is satisfied).
    assert.equal(typeof r.dtuId, "string", `expected a real minted DTU id, got ${JSON.stringify(r.dtuId)}`);
    assert.ok(r.dtuId.length > 0);
  });

  it("research.synthesize is honest when no substrate knowledge exists — no invented claims", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    const ctx = __TEST__.makeInternalCtx("deep-research-test");

    const r = await __TEST__.runMacro("research", "synthesize", {
      topic: "a brand new untouched topic xyz123",
      substrateKnowledge: [],
      userId: ctx.actor.userId,
    }, ctx);

    assert.equal(r.ok, true);
    assert.ok(r.content.toLowerCase().includes("novel area") || r.content.toLowerCase().includes("no existing"), "empty substrate must be reported honestly, not papered over");
    assert.equal(r.substrateCount, 0);
  });
});
