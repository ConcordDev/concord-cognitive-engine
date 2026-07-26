/**
 * Plugin loader <-> sandbox integration tests.
 *
 * Proves the wiring in `server/plugins/loader.js#loadPluginFromSource` /
 * `loadPluginsFromDisk`: the static 4-gate validator (`validator.js`, left
 * UNCHANGED) still runs and can reject a plugin before it ever reaches the
 * sandbox, AND — the load-bearing new claim — a plugin whose source
 * genuinely EVADES that regex-based gate (so it loads/validates/activates
 * successfully) is nonetheless unable to touch the filesystem/process/
 * child_process when its registered macro actually executes, because
 * execution happens inside `plugin-sandbox.js`'s worker+vm isolation, not
 * as a plain in-process function call.
 *
 * Run: node --test server/tests/plugin-loader-sandbox-integration.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validatePlugin as runValidation } from "../plugins/validator.js";
import {
  loadPluginFromSource,
  loadPluginsFromDisk,
  getPluginMetrics,
  unloadPlugin,
} from "../plugins/loader.js";

// Minimal fake STATE — plugin store lives under emergent state, same shape
// `getEmergentState` expects (a plain object it will attach `_plugins` to).
function makeState() {
  return { dtus: new Map(), db: null, emergent: {} };
}

// Minimal fake macro registry standing in for server.js's real `register`.
function makeRegistry() {
  const macros = new Map(); // "domain.action" -> handler
  return {
    macros,
    register(domain, action, handler /* , meta */) {
      macros.set(`${domain}.${action}`, handler);
    },
    async run(domain, action, input = {}) {
      const key = `${domain}.${action}`;
      const handler = macros.get(key);
      if (!handler) throw new Error(`no such macro registered: ${key}`);
      return handler({}, input);
    },
  };
}

describe("loadPluginFromSource — legitimate plugin end-to-end through the loader", () => {
  it("activates, registers its macro, and the macro round-trips through the real runMacro passed in", async () => {
    const STATE = makeState();
    const registry = makeRegistry();

    const calls = [];
    const runMacro = async (domain, name, input) => {
      calls.push([domain, name, input]);
      return { ok: true, result: { id: "dtu_integration_1", ...input } };
    };

    const source = `
      export const id = "example.integration-mint";
      export const name = "Integration Mint";
      export const version = "1.0.0";
      export function init(ctx) { ctx.log("info", "up"); return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "integrationmint.create": async (ctx, input) => {
          return ctx.callMacro("dtu", "create", { title: input.title });
        },
      };
    `;

    const result = await loadPluginFromSource(STATE, source, {
      register: registry.register,
      runMacro,
      manifest: { macros: ["dtu.*"] },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pluginId, "example.integration-mint");
    assert.deepEqual(result.macros, ["integrationmint.create"]);

    const macroResult = await registry.run("integrationmint", "create", { title: "hi" });
    assert.equal(macroResult.ok, true);
    assert.equal(macroResult.result.id, "dtu_integration_1");
    assert.deepEqual(calls, [["dtu", "create", { title: "hi" }]]);

    const metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 1);
    assert.equal(metrics.plugins[0].id, "example.integration-mint");

    unloadPlugin(STATE, "example.integration-mint");
  });

  it("a manifest that does NOT grant the domain the plugin calls gets capability_denied — sandbox does not bypass confinement", async () => {
    const STATE = makeState();
    const registry = makeRegistry();
    const runMacro = async () => ({ ok: true, result: {} });

    const source = `
      export const id = "example.integration-unauthorized";
      export const name = "Integration Unauthorized";
      export const version = "1.0.0";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "unauthorized.tryAdmin": async (ctx) => ctx.callMacro("admin", "wipe", {}),
      };
    `;

    const result = await loadPluginFromSource(STATE, source, {
      register: registry.register,
      runMacro,
      manifest: { macros: ["dtu.*"] }, // does NOT grant admin.*
    });
    assert.equal(result.ok, true);

    const r = await registry.run("unauthorized", "tryAdmin", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "capability_denied");

    unloadPlugin(STATE, "example.integration-unauthorized");
  });
});

describe("loadPluginFromSource — the static validator still runs BEFORE the sandbox (defense in depth retained)", () => {
  it("rejects a plugin whose source contains a literal banned pattern, without ever spinning up a worker", async () => {
    const STATE = makeState();
    const registry = makeRegistry();

    const maliciousSource = `
      export const id = "example.integration-blocked";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "blocked.readFile": async () => {
          const fsmod = require('fs');
          return fsmod.readFileSync('/etc/passwd', 'utf8');
        },
      };
    `;

    // Sanity: confirm validator.js's regex gate DOES catch this literal form —
    // this is the "before" case the sandbox is layered on top of, not a
    // replacement for.
    const staticCheck = runValidation(
      { id: "example.integration-blocked", name: "x", version: "1.0.0", init() {}, destroy() {} },
      { sourceCode: maliciousSource },
    );
    assert.equal(staticCheck.valid, false);
    assert.ok(staticCheck.gates.find((g) => g.name === "patterns" && !g.passed));

    const result = await loadPluginFromSource(STATE, maliciousSource, { register: registry.register });
    assert.equal(result.ok, false);
    assert.equal(result.error, "validation_failed");
    assert.ok(result.validation.errors.some((e) => e.includes("prohibited_pattern")));

    // Never activated.
    const metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 0);
  });
});

describe("loadPluginFromSource — a plugin that EVADES the static regex gate is still blocked at execution time", () => {
  it("passes validator.js's patterns gate (proving the regex genuinely misses this obfuscation) yet cannot read the filesystem when its macro runs", async () => {
    // The evasion here is argument-level indirection on a literal
    // `require(...)` call: validator.js's Gate 3 regex
    // (`/\brequire\s*\(\s*['"](?:child_process|fs|net|...)/`) only matches
    // when the banned module name is a literal string immediately inside
    // the parentheses. Building the module name in a variable first means
    // the literal text `require(modName)` never contains "fs"/"child_process"
    // /etc, so the regex has nothing to match — genuinely missed, not just
    // a contrived edge case. (A naive `globalThis['requi'+'re']` trick is
    // NOT a good evasion example — validator.js already has an explicit
    // `/\bglobalThis\s*\[/` rule that catches it; this is a case the current
    // gate really does miss.)
    const evasiveSource = `
      export const id = "example.integration-evasion";
      export const name = "Integration Evasion";
      export const version = "1.0.0";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "evasion.readFile": async () => {
          const out = {};
          try {
            const modName = 'fs'; // not a literal inside require(...)
            const fsmod = require(modName);
            out.result = 'SUCCEEDED:' + fsmod.readFileSync('/etc/passwd', 'utf8').slice(0, 5);
          } catch (e) {
            out.result = 'THREW:' + e.message;
          }
          return out;
        },
      };
    `;

    // Ground truth for the "genuinely evades" claim: validator.js's own
    // patterns gate, run directly against this exact source, PASSES it.
    const staticCheck = runValidation(
      { id: "example.integration-evasion", name: "x", version: "1.0.0", init() {}, destroy() {} },
      { sourceCode: evasiveSource },
    );
    const patternsGate = staticCheck.gates.find((g) => g.name === "patterns");
    assert.equal(patternsGate.passed, true, "expected the regex gate to MISS the argument-indirected require — that's the point being proven");

    // The loader's own full pipeline agrees: this plugin loads successfully.
    const STATE = makeState();
    const registry = makeRegistry();
    const result = await loadPluginFromSource(STATE, evasiveSource, { register: registry.register });
    assert.equal(result.ok, true, JSON.stringify(result));

    // But when the registered macro actually executes (inside the sandbox),
    // the filesystem is genuinely unreachable — not merely undetected. There
    // is no `require` binding in the vm context at all, so the call throws
    // a ReferenceError rather than succeeding.
    const macroResult = await registry.run("evasion", "readFile", {});
    assert.match(macroResult.result, /^THREW:/);
    assert.doesNotMatch(macroResult.result, /SUCCEEDED/);

    unloadPlugin(STATE, "example.integration-evasion");
  });
});

describe("loadPluginsFromDisk — real disk scan activates a plugin through the sandbox", () => {
  it("discovers a plugin file on disk, activates it asynchronously, and its macro works once ready", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-plugin-sandbox-test-"));
    const pluginDir = path.join(dir, "disk-example");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "index.js"),
      `
        export const id = "example.disk-loaded";
        export const name = "Disk Loaded Example";
        export const version = "1.0.0";
        export function init() { return { ok: true }; }
        export function destroy() {}
        export const macros = {
          "diskloaded.ping": async () => ({ ok: true, pong: true }),
        };
      `,
      "utf8",
    );

    const STATE = makeState();
    const registry = makeRegistry();

    const syncResult = loadPluginsFromDisk(STATE, { installedDir: dir, register: registry.register });
    assert.equal(syncResult.ok, true);
    assert.equal(syncResult.scanning, 1);

    // Activation is async (background) — poll briefly for it to land.
    const deadline = Date.now() + 5000;
    let loaded = false;
    while (Date.now() < deadline) {
      if (getPluginMetrics(STATE).loadedCount >= 1) { loaded = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(loaded, true, "expected the disk-scanned plugin to finish activating within 5s");

    const macroResult = await registry.run("diskloaded", "ping", {});
    assert.equal(macroResult.pong, true);

    unloadPlugin(STATE, "example.disk-loaded");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns cleanly (no scanning) when the installed/ directory doesn't exist", () => {
    const STATE = makeState();
    const result = loadPluginsFromDisk(STATE, { installedDir: "/nonexistent/concord-plugins-dir-xyz" });
    assert.equal(result.ok, true);
    assert.equal(result.scanning, 0);
  });
});
