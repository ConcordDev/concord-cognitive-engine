// server/tests/depth/plugin-register-source-behavior.test.js — REAL
// behavioral tests for the fixed `emergent.plugin.register` macro
// (server/emergent/index.js), which backs `POST /api/plugins/register`
// (server.js).
//
// Before this fix, the macro forwarded a JSON-parsed `input.module` object
// straight into the in-process `registerPlugin` → `activatePlugin` path
// (server/plugins/loader.js). That contract could never actually work over
// the real HTTP route: a JSON request body cannot carry live
// `init`/`macros`/`hooks` functions, so `activatePlugin`'s Gate 1
// (`missing_init_function`) would always reject anything genuinely
// submitted this way.
//
// The fix: the macro now accepts raw plugin ESM SOURCE TEXT as a string
// (`input.source`) and routes it through the same hardened, sandboxed path
// the boot-time disk scan uses — `loadPluginFromSource`
// (worker_threads + vm isolation + the full 4-gate validator, run twice).
// This makes `POST /api/plugins/register` a real, working "submit plugin
// source" endpoint for admin/founder/owner-gated internal use.
// See docs/PLUGIN_AUTHORING_GUIDE.md §3 for the full write-up.
//
// This boots the real server once (the established `macroRuntime` harness —
// see server/tests/depth/_harness.js and e.g.
// atlas-signal-classify-behavior.test.js) and calls the LIVE
// `emergent.plugin.register` macro through the real `runMacro`, so this is
// a genuine end-to-end proof, not a reimplementation of the logic under
// test.
//
// Run: node --test server/tests/depth/plugin-register-source-behavior.test.js
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("emergent.plugin.register — real source-text submission through the sandboxed loader", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("plugin-register")); });

  it("loads and activates a plugin from real ESM source text, and its macro is callable through the live runMacro", async () => {
    const source = `
      export const id = "example.orchestra-register-source";
      export const name = "Orchestra Register Source Test";
      export const version = "1.0.0";
      export function init(ctx) { ctx.log("info", "orchestra register test up"); return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "orchestraregistersource.ping": async () => ({ ok: true, pong: true }),
      };
    `;

    const result = await runMacro("emergent", "plugin.register", { source }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pluginId, "example.orchestra-register-source");
    assert.deepEqual(result.macros, ["orchestraregistersource.ping"]);

    // The load-bearing claim: the plugin's own macro was really registered
    // into the live MACROS map (not just bookkeeping) and is callable
    // through the real runMacro, exactly like any built-in domain macro.
    const pingResult = await runMacro("orchestraregistersource", "ping", {}, ctx);
    assert.equal(pingResult.ok, true);
    assert.equal(pingResult.pong, true);

    // Also prove the round-trip through emergent.plugin.get — confirms
    // this landed in the real plugin store, not a side channel.
    const getResult = await runMacro("emergent", "plugin.get", { pluginId: "example.orchestra-register-source" }, ctx);
    assert.equal(getResult.ok, true);
    assert.equal(getResult.plugin.id, "example.orchestra-register-source");

    const unloadResult = await runMacro("emergent", "plugin.unload", { pluginId: "example.orchestra-register-source" }, ctx);
    assert.equal(unloadResult.ok, true, JSON.stringify(unloadResult));
  });

  it("rejects a submission with no `source` string, with a clear actionable message", async () => {
    const noSource = await runMacro("emergent", "plugin.register", {}, ctx);
    assert.equal(noSource.ok, false);
    assert.equal(noSource.error, "source_required");
    assert.match(noSource.message, /source/i);
    assert.match(noSource.message, /JSON module object/i);
  });

  it("honestly rejects the OLD, broken contract shape (a JSON module object) instead of silently accepting it", async () => {
    // This is exactly the shape the route used to forward straight into
    // activatePlugin(): `init` has survived JSON transport as an empty
    // object, never a function. Pre-fix this was accepted by the presence
    // check (`if (!input.module) ...`) and only failed deep inside
    // activatePlugin with `missing_init_function`. Post-fix it's rejected
    // immediately and honestly at the macro boundary.
    const oldStyleModuleObject = await runMacro("emergent", "plugin.register", {
      module: {
        id: "example.old-style-should-not-work",
        name: "Old Style",
        version: "1.0.0",
        init: {}, // what a function looks like after surviving JSON.parse
        destroy: {},
      },
    }, ctx);
    assert.equal(oldStyleModuleObject.ok, false);
    assert.equal(oldStyleModuleObject.error, "source_required");

    // And it was never actually loaded.
    const getResult = await runMacro("emergent", "plugin.get", { pluginId: "example.old-style-should-not-work" }, ctx);
    assert.equal(getResult.ok, false);
  });

  it("still runs the real 4-gate validator against submitted source — a malformed plugin is honestly rejected, not silently accepted", async () => {
    const malformed = `
      export const name = "Missing Id And Init";
      export const version = "1.0.0";
    `; // no id, no init, no destroy — fails validator.js's shape gate

    const result = await runMacro("emergent", "plugin.register", { source: malformed }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error, "validation_failed");
  });
});
