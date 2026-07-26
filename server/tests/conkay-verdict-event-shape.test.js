/**
 * `conkay:verdict` — R5/E22 ConKay spatial mode (Godot Hub) event contract.
 *
 * Mirrors the existing conkay-macro-lifecycle.test.js pattern (same file it
 * sits alongside): pins the EVENT_SHAPES registration/validation half of the
 * contract, and proves `realtimeEmit` accepts the same userId-scoped
 * targeting option macro:started/macro:completed already use — the exact
 * path that reaches a connected Godot client via `_godotGatewayEmitter`
 * (server.js's realtimeEmit, `{ userId }` branch) with zero new transport
 * code. The pure derivation logic itself (which macro pairs produce a
 * verdict, how the tier is computed) is unit-tested in isolation at
 * tests/conkay-verdict-bridge.test.js and tests/capability-tier.test.js —
 * this file is deliberately just the wire-contract half.
 *
 * Run: node --test tests/conkay-verdict-event-shape.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVENT_SHAPES, validateEvent } from "../lib/event-shapes.js";
import { deriveConkayVerdictEmit } from "../lib/conkay-verdict-bridge.js";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

let _serverTestSurface;
registerServerCleanExit(() => _serverTestSurface);

describe("conkay:verdict — EVENT_SHAPES registration", () => {
  it("registers conkay:verdict alongside macro:started/completed", () => {
    assert.ok(EVENT_SHAPES["conkay:verdict"], "conkay:verdict must be registered");
    assert.deepEqual(EVENT_SHAPES["conkay:verdict"].required, ["runId", "domain", "action", "tier"]);
  });

  it("accepts the exact payload shape deriveConkayVerdictEmit produces, wrapped the way emitMacroLife wraps it", () => {
    const derived = deriveConkayVerdictEmit("reason", "verify", { ok: true, verdict: "grounded", confidence: 0.7 });
    // emitMacroLife("conkay:verdict", derived) prepends {runId, domain, action}
    // the same way it does for macro:completed — reconstruct that shape here.
    const payload = { runId: "r-1", domain: "reason", action: "verify", ...derived };
    const v = validateEvent("conkay:verdict", payload);
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("accepts a tier with no confidence (reasoned/unverified verdicts often carry none)", () => {
    const v = validateEvent("conkay:verdict", { runId: "r-1", domain: "reason", action: "verify", tier: "reasoned", verdict: "citations_resolve" });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("rejects a payload missing the required tier field", () => {
    const v = validateEvent("conkay:verdict", { runId: "r-1", domain: "reason", action: "verify" });
    assert.equal(v.ok, false);
    assert.ok((v.missing || []).includes("tier"));
  });

  it("rejects a payload missing the runId correlation id", () => {
    const v = validateEvent("conkay:verdict", { domain: "reason", action: "verify", tier: "proven" });
    assert.equal(v.ok, false);
    assert.ok((v.missing || []).includes("runId"));
  });
});

describe("conkay:verdict — realtimeEmit userId targeting (same mirror path macro:started/completed use)", () => {
  it("realtimeEmit accepts { userId } for conkay:verdict without throwing", async () => {
    _serverTestSurface = (await import("../server.js")).__TEST__;
    const { realtimeEmit } = _serverTestSurface;
    const out = realtimeEmit(
      "conkay:verdict",
      { runId: "r-test", domain: "reason", action: "verify", tier: "proven", verdict: "grounded", confidence: 0.9 },
      { userId: "user-123" },
    );
    assert.ok(out && typeof out === "object", "must return a result object");
    assert.ok(
      out.ok === true || out.reason === "socket_not_ready",
      `unexpected realtimeEmit result: ${JSON.stringify(out)}`,
    );
  });
});
