/**
 * Regression test for the MCP tool-dispatch bug (distribution wedge).
 *
 * The MCP host calls runMacro(domain, macro) for each exposed tool, but
 * runMacro only sees the MACROS registry. `concord.math` is wired to
 * `math.symbolicCompute`, which is a registerLensAction handler (LENS_ACTIONS),
 * so the tool threw "macro not found" at call time — the verified-compute
 * differentiator was silently dead, and the existing MCP tests (which only
 * assert the static tool LIST) didn't catch it.
 *
 * server.js#runMcpTool now mirrors the /api/lens/run dispatch: prefer
 * LENS_ACTIONS, fall back to MACROS. This test pins that a lens-action tool is
 * reachable through that dispatch (and that a macro-only runner is NOT — the
 * bug), plus the operation-alias fix (differentiate→derivative, integrate→integral).
 *
 * Run: node --test server/tests/mcp-tool-dispatch.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMathActions from "../domains/math.js";
import { unreachableTools } from "../lib/mcp-server-host.js";

// Build the two registries the way server.js does.
const LENS_ACTIONS = new Map();
const MACROS = new Map();
before(() => {
  registerMathActions((domain, name, fn) => LENS_ACTIONS.set(`${domain}.${name}`, fn));
});

// Faithful copy of server.js#runMcpTool (prefer LENS_ACTIONS, then MACROS).
async function runMcpTool(domain, name, input, ctx = {}) {
  const lensHandler = LENS_ACTIONS.get(`${domain}.${name}`);
  if (lensHandler) {
    const virtualArtifact = { id: null, domain, type: "domain_action", data: input || {}, meta: {} };
    return await lensHandler(ctx, virtualArtifact, input || {});
  }
  const d = MACROS.get(domain);
  if (!d?.get(name)) throw new Error(`macro not found: ${domain}.${name}`);
  return await d.get(name)(ctx, input || {});
}

// The OLD macro-only runner the bug came from.
async function macroOnly(domain, name) {
  const d = MACROS.get(domain);
  if (!d?.get(name)) throw new Error(`macro not found: ${domain}.${name}`);
  return d.get(name);
}

describe("MCP concord.math reachability (the bug)", () => {
  it("the macro-only path THROWS on math.symbolicCompute (documents why the fix was needed)", async () => {
    await assert.rejects(() => macroOnly("math", "symbolicCompute"), /macro not found/);
  });

  it("the lens-aware runner reaches the real CAS — simplify", async () => {
    const r = await runMcpTool("math", "symbolicCompute", { expression: "x + x", operation: "simplify" });
    assert.equal(r.ok, true);
    assert.equal(r.result.operation, "simplify");
    assert.ok(typeof r.result.output === "string" && r.result.output.length > 0);
  });

  it("differentiate alias resolves to the derivative branch", async () => {
    const r = await runMcpTool("math", "symbolicCompute", { expression: "x^2", operation: "differentiate" });
    assert.equal(r.ok, true);
    assert.equal(r.result.operation, "derivative");
    // d/dx x^2 = 2*x — assert it computed a real derivative, not an error.
    assert.match(r.result.derivative.replace(/\s/g, ""), /2\*x|x\*2/);
  });

  it("integrate alias resolves to the integral branch (definite via bounds)", async () => {
    const r = await runMcpTool("math", "symbolicCompute", { expression: "x", operation: "integrate", lower: 0, upper: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.operation, "integral");
    // ∫₀² x dx = 2
    assert.equal(Number(r.result.definite), 2);
  });

  it("canonical op names still work (derivative)", async () => {
    const r = await runMcpTool("math", "symbolicCompute", { expression: "x^3", operation: "derivative" });
    assert.equal(r.ok, true);
    assert.equal(r.result.operation, "derivative");
  });

  it("returns an honest envelope on a bad expression (no throw)", async () => {
    const r = await runMcpTool("math", "symbolicCompute", { expression: "", operation: "simplify" });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
});

describe("MCP reachability self-check (unreachableTools)", () => {
  it("flags concord.math when the resolver is macro-only (the bug), clean when lens-aware", () => {
    // macro-only resolver: math.symbolicCompute lives in LENS_ACTIONS, so a
    // macro-only predicate can't see it — exactly the boot warning we want.
    const macroOnlyResolve = () => false; // no macros registered here
    assert.ok(unreachableTools(macroOnlyResolve).includes("concord.math"));

    // lens-aware resolver (matches server.js#runMcpTool dispatch): math resolves.
    const lensAwareResolve = (domain, name) =>
      LENS_ACTIONS.has(`${domain}.${name}`) || ["discovery.search", "expert_mode.answer", "tools.web_search", "lens.list", "event_timeline.recent", "cross_world_effectiveness.explain", "reason.verify", "dtu.create"].includes(`${domain}.${name}`);
    assert.equal(unreachableTools(lensAwareResolve).includes("concord.math"), false, "math reachable via LENS_ACTIONS");
  });
});
