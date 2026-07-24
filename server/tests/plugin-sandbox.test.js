/**
 * Plugin Sandbox — genuine process isolation contract tests.
 *
 * `server/lib/plugin-sandbox.js` is the hardened SECOND layer underneath
 * `server/plugins/validator.js`'s 4 static gates: plugin source executes
 * inside a `worker_threads` Worker, under Node's permission model (zero
 * --allow-* flags), inside a `vm.SourceTextModule` context with
 * `codeGeneration: { strings: false }` and no globals beyond a message-
 * passing `ctx` bridge. These tests prove the isolation actually holds at
 * runtime — not merely that validator.js's regex would have caught
 * something (see the sibling test file
 * `plugin-loader-sandbox-integration.test.js` for the direct side-by-side
 * proof that the regex gate and the sandbox catch DIFFERENT things).
 *
 * Run: node --test server/tests/plugin-sandbox.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginSandbox } from "../lib/plugin-sandbox.js";

describe("PluginSandbox — legitimate plugin using only the confined-ctx API", () => {
  it("loads, reflects its shape, runs init, and round-trips a macro call through the message bridge", async () => {
    const source = `
      export const id = "example.sandbox-mint";
      export const name = "Sandbox Mint Example";
      export const version = "1.0.0";
      export const description = "Mints a DTU via the confined ctx.callMacro bridge.";
      let _initialized = false;
      export function init(ctx) { _initialized = true; ctx.log("info", "initialized"); return { ok: true }; }
      export function destroy() { _initialized = false; }
      export const macros = {
        "sandboxmint.create": async (ctx, input) => {
          const r = await ctx.callMacro("dtu", "create", { title: input.title });
          await ctx.store.set("lastTitle", input.title);
          const remembered = await ctx.store.get("lastTitle");
          return { ok: true, dtu: r.result, remembered };
        },
      };
    `;

    const seenCalls = [];
    const bridge = {
      callMacro: async (domain, name, input) => {
        seenCalls.push([domain, name, input]);
        return { ok: true, result: { id: "dtu_e2e_1", title: input.title } };
      },
      log: () => {},
      storeGet: async (key) => (key === "lastTitle" ? "hello world" : null),
      storeSet: async () => true,
    };

    const sandbox = new PluginSandbox({ pluginId: "example.sandbox-mint", sourceCode: source, bridge });
    const shape = await sandbox.load();

    assert.equal(shape.id, "example.sandbox-mint");
    assert.equal(shape.hasInit, true);
    assert.equal(shape.hasDestroy, true);
    assert.deepEqual(shape.macroNames, ["sandboxmint.create"]);

    const initResult = await sandbox.callInit();
    assert.equal(initResult.ok, true);

    const macroResult = await sandbox.callMacroHandler("sandboxmint.create", { title: "hello world" });
    assert.equal(macroResult.ok, true);
    assert.equal(macroResult.dtu.id, "dtu_e2e_1");
    assert.equal(macroResult.dtu.title, "hello world");
    assert.equal(macroResult.remembered, "hello world");

    assert.deepEqual(seenCalls, [["dtu", "create", { title: "hello world" }]]);

    await sandbox.destroy();
  });
});

describe("PluginSandbox — obfuscated escape attempts are blocked at the EXECUTION layer", () => {
  it("a variable-indirected require('fs') (no literal 'require(\"fs\"' text) resolves to undefined and cannot read the filesystem", async () => {
    // This obfuscation style is chosen deliberately: validator.js's Gate 3 is
    // a set of plain regexes matched against literal source text, e.g.
    // `/\brequire\s*\(\s*['"](?:child_process|fs|net|...)/` — which requires
    // the banned module name to appear as a literal string LITERALLY inside
    // the parentheses. `const modName = 'fs'; require(modName)` never
    // contains that substring (the argument is a bare identifier, not a
    // string literal) so the regex gate does NOT catch it — proven directly
    // against validator.js in the sibling integration test file
    // (`plugin-loader-sandbox-integration.test.js`), which asserts the
    // patterns gate PASSES this exact source. (For contrast: a naive
    // `globalThis['requi' + 're']` trick is actually already caught by
    // validator.js's `/\bglobalThis\s*\[/` rule — that gate is more robust
    // than it might look. The genuine gap is argument-level indirection on a
    // literal `require(...)`/`import(...)` call, not identifier obfuscation.)
    // The sandbox has to hold independently of the regex either way.
    const source = `
      export const id = "example.sandbox-evasion";
      export const name = "Evasion Attempt";
      export const version = "1.0.0";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "evasion.attempt": async () => {
          const out = {};
          try {
            const modName = 'fs'; // built at runtime, not a literal in the require(...) call
            const fsmod = require(modName);
            out.fsReadResult = 'SUCCEEDED:' + fsmod.readFileSync('/etc/passwd', 'utf8').slice(0, 5);
          } catch (e) {
            out.fsReadResult = 'THREW:' + e.message;
          }
          try { out.requireType = typeof require; } catch (e) { out.requireType = 'threw'; }
          try { out.processType = typeof process; } catch (e) { out.processType = 'threw'; }
          try { out.fetchType = typeof fetch; } catch (e) { out.fetchType = 'threw'; }
          try { out.evalResult = eval('1+1'); } catch (e) { out.evalResult = 'BLOCKED:' + e.message; }
          try { out.newFunctionResult = new Function('return 1+1')(); } catch (e) { out.newFunctionResult = 'BLOCKED:' + e.message; }
          return out;
        },
      };
    `;

    const bridge = { callMacro: async () => ({ ok: true }), log: () => {} };
    const sandbox = new PluginSandbox({ pluginId: "example.sandbox-evasion", sourceCode: source, bridge });
    await sandbox.load();

    const result = await sandbox.callMacroHandler("evasion.attempt", {});

    // `require` is simply not a defined identifier in the vm context — the
    // indirection through a variable module name doesn't matter, because
    // there is no `require` function to call at all.
    assert.equal(result.requireType, "undefined");
    assert.match(result.fsReadResult, /^THREW:/);
    assert.doesNotMatch(result.fsReadResult, /SUCCEEDED/);

    // process / fetch are likewise structurally absent.
    assert.equal(result.processType, "undefined");
    assert.equal(result.fetchType, "undefined");

    // eval()/new Function(str) are blocked by codeGeneration:{strings:false}
    // — V8 refuses to compile code from strings in this vm context at all.
    assert.match(result.evalResult, /^BLOCKED:/);
    assert.match(result.newFunctionResult, /^BLOCKED:/);

    await sandbox.destroy();
  });

  it("static imports of any kind are rejected by the module linker (no import escape hatch either)", async () => {
    const source = `
      import fs from 'node:fs';
      export const id = "example.sandbox-import-evasion";
      export function init() { return { ok: true }; }
      export function destroy() {}
    `;
    const sandbox = new PluginSandbox({ pluginId: "example.sandbox-import-evasion", sourceCode: source, bridge: {} });
    await assert.rejects(() => sandbox.load(), /plugin_imports_not_allowed|load/i);
  });
});

describe("PluginSandbox — runaway plugin is killed by the timeout guard", () => {
  it("terminates a synchronous infinite loop via worker.terminate() instead of hanging the host", async () => {
    const source = `
      export const id = "example.sandbox-runaway";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "runaway.spin": async () => { while (true) { /* never returns */ } },
      };
    `;
    const bridge = { callMacro: async () => ({ ok: true }), log: () => {} };
    const sandbox = new PluginSandbox({
      pluginId: "example.sandbox-runaway",
      sourceCode: source,
      bridge,
      timeoutMs: 500, // short, bounded timeout so the test itself stays fast
    });
    await sandbox.load();

    const start = Date.now();
    await assert.rejects(
      () => sandbox.callMacroHandler("runaway.spin", {}),
      /plugin_sandbox_timeout/,
    );
    const elapsed = Date.now() - start;

    // Bounded: the call must not have hung past ~2x the configured timeout.
    assert.ok(elapsed < 2000, `expected timely termination, took ${elapsed}ms`);
    // The sandbox must have actually torn down the worker, not merely
    // rejected the promise while the runaway loop keeps burning CPU.
    assert.equal(sandbox.destroyed, true);
  });

  it("also bounds a runaway tick() the same way", async () => {
    const source = `
      export const id = "example.sandbox-runaway-tick";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export function tick() { while (true) { /* never returns */ } }
    `;
    const bridge = { callMacro: async () => ({ ok: true }), log: () => {} };
    const sandbox = new PluginSandbox({
      pluginId: "example.sandbox-runaway-tick",
      sourceCode: source,
      bridge,
    });
    const shape = await sandbox.load();
    assert.equal(shape.hasTick, true);

    const start = Date.now();
    await assert.rejects(() => sandbox.tick(), /plugin_sandbox_timeout/);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `expected tick timeout to bound execution, took ${elapsed}ms`);
    assert.equal(sandbox.destroyed, true);
  });
});

describe("PluginSandbox — resource limits are applied to the worker", () => {
  it("accepts custom resourceLimits without breaking normal execution", async () => {
    const source = `
      export const id = "example.sandbox-reslimits";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = { "reslimits.ping": async () => ({ ok: true, pong: true }) };
    `;
    const sandbox = new PluginSandbox({
      pluginId: "example.sandbox-reslimits",
      sourceCode: source,
      bridge: {},
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 8, stackSizeMb: 2 },
    });
    await sandbox.load();
    const r = await sandbox.callMacroHandler("reslimits.ping", {});
    assert.equal(r.pong, true);
    await sandbox.destroy();
  });
});
