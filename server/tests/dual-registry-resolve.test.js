// server/tests/dual-registry-resolve.test.js
//
// Pins resolveDualRegistry — the shared "prefer LENS_ACTIONS, then MACROS"
// resolution helper now used by both server.js's runMcpTool (MCP server +
// /api/lens/run) and server/lib/chat-agent.js's run_lens_action tool. See
// docs/CONKAY_TOOL_AUTHORING_SPEC.md's "Corrections to the task's framing"
// section for the reachability gap this closed.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDualRegistry } from "../lib/dual-registry-resolve.js";

test("resolveDualRegistry resolves via lens_action when the key is present in LENS_ACTIONS", () => {
  const handler = async () => ({ ok: true });
  const lensActions = new Map([["legal.summarize", handler]]);
  const result = resolveDualRegistry("legal", "summarize", { lensActions, runMacro: async () => ({ ok: true, via: "macro" }) });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, handler);
  assert.equal(result.key, "legal.summarize");
});

test("resolveDualRegistry falls back to macro when the key is absent from LENS_ACTIONS but runMacro is a function", () => {
  const lensActions = new Map(); // empty — nothing registered via registerLensAction
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
  assert.equal(result.key, "plugin_demo.compute");
  assert.equal(result.handler, undefined);
});

test("resolveDualRegistry falls back to macro when lensActions itself is missing/invalid but runMacro exists", () => {
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions: null, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
});

test("resolveDualRegistry falls back to macro when lensActions has no .get (malformed injection)", () => {
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions: {}, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
});

test("resolveDualRegistry reports none when neither registry is usable", () => {
  const result = resolveDualRegistry("ghost", "noop", { lensActions: null, runMacro: null });
  assert.equal(result.via, "none");
  assert.equal(result.key, "ghost.noop");
});

test("resolveDualRegistry reports none when lensActions is empty and runMacro is not a function", () => {
  const result = resolveDualRegistry("ghost", "noop", { lensActions: new Map(), runMacro: undefined });
  assert.equal(result.via, "none");
});

test("resolveDualRegistry prefers lens_action over macro when both could resolve the same key", () => {
  const handler = async () => ({ ok: true, via: "lens_action" });
  const lensActions = new Map([["legal.summarize", handler]]);
  const result = resolveDualRegistry("legal", "summarize", { lensActions, runMacro: async () => ({ ok: true, via: "macro" }) });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, handler);
});

// INC-SWEEP batch 012 — COMMON_ACTIONS fill-ins must not shadow MACROS.
test("COMMON_ACTIONS fill-in yields to MACROS when commonActionKeys marks the pair", () => {
  const generic = async () => ({ ok: true, via: "common" });
  const lensActions = new Map([["civic_bonds.vote", generic]]);
  const macros = fakeMacros(["civic_bonds.vote"]);
  const commonActionKeys = new Set(["civic_bonds.vote"]);
  const result = resolveDualRegistry("civic_bonds", "vote", {
    lensActions, runMacro: async () => ({ ok: true }), macros, commonActionKeys,
  });
  assert.equal(result.via, "macro");
  assert.equal(result.handler, undefined);
});

test("real LENS_ACTION still wins over MACROS when the key is NOT a COMMON_ACTIONS fill-in", () => {
  const real = async () => ({ ok: true, via: "lens_action" });
  const lensActions = new Map([["council.vote", real]]);
  const macros = fakeMacros(["council.vote"]);
  const commonActionKeys = new Set(["civic_bonds.vote"]); // council.vote not marked
  const result = resolveDualRegistry("council", "vote", {
    lensActions, runMacro: async () => ({ ok: true }), macros, commonActionKeys,
  });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, real);
});

test("COMMON_ACTIONS fill-in with no MACROS peer stays via lens_action (intentionally-generic)", () => {
  const generic = async () => ({ ok: true, via: "common" });
  const lensActions = new Map([["accounting.vote", generic]]);
  const macros = fakeMacros([]); // no accounting.vote macro
  const commonActionKeys = new Set(["accounting.vote"]);
  const result = resolveDualRegistry("accounting", "vote", {
    lensActions, runMacro: async () => ({ ok: true }), macros, commonActionKeys,
  });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, generic);
});

// ── strict registration check (2026-09-10) ──────────────────────────────────
// The "prefer LENS_ACTIONS, then MACROS" resolver used to return via:"macro"
// for ANY pair as long as runMacro was a function — so a misnamed/nonexistent
// (domain, action), the exact thing ConKay guesses wrong, resolved as a
// "macro" and the caller's runMacro() then threw an opaque "macro not found".
// With a real MACROS map to consult, an unregistered pair now returns
// via:"none" so the caller can surface an actionable "wrong name, list the
// real ones" error.

function fakeMacros(pairs) {
  // pairs: ["domain.name", ...] -> Map<domain, Map<name, entry>>
  const m = new Map();
  for (const p of pairs) {
    const [d, n] = p.split(".");
    if (!m.has(d)) m.set(d, new Map());
    m.get(d).set(n, { fn: async () => ({ ok: true }) });
  }
  return m;
}

test("strict: a MACROS-registered pair resolves via:macro", () => {
  const r = resolveDualRegistry("physics", "power", {
    lensActions: new Map(), runMacro: async () => ({ ok: true }),
    macros: fakeMacros(["physics.power", "physics.ohmsLaw"]),
  });
  assert.equal(r.via, "macro");
  assert.equal(r.key, "physics.power");
});

test("strict: an UNregistered pair resolves via:none with reason not_registered", () => {
  const r = resolveDualRegistry("physics", "teleport", {
    lensActions: new Map(), runMacro: async () => ({ ok: true }),
    macros: fakeMacros(["physics.power"]),
  });
  assert.equal(r.via, "none");
  assert.equal(r.reason, "not_registered");
});

test("strict: LENS_ACTIONS still wins over a MACROS miss", () => {
  const handler = async () => ({ ok: true });
  const r = resolveDualRegistry("code", "exec", {
    lensActions: new Map([["code.exec", handler]]),
    runMacro: async () => ({ ok: true }),
    macros: fakeMacros([]), // not in MACROS
  });
  assert.equal(r.via, "lens_action");
  assert.equal(r.handler, handler);
});

test("strict:false opts back into permissive via:macro even with a MACROS miss", () => {
  const r = resolveDualRegistry("physics", "teleport", {
    lensActions: new Map(), runMacro: async () => ({ ok: true }),
    macros: fakeMacros(["physics.power"]), strict: false,
  });
  assert.equal(r.via, "macro");
});

test("no MACROS map available (isolated unit context) stays permissive via:macro", () => {
  const r = resolveDualRegistry("plugin_demo", "compute", {
    lensActions: new Map(), runMacro: async () => ({ ok: true }),
    // no `macros`, and globalThis._concordMACROS is unset in this test process
  });
  assert.equal(r.via, "macro");
});
