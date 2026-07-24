/**
 * Fixed example plugin — server/plugins/installed/example-knowledge-weather/index.js.
 *
 * The shipped example used to call `ctx.schedule.every(...)`,
 * `ctx.storage.get`/`.set`, a bare `fetch(...)`, and `ctx.createDTU(...)` —
 * none of which exist on the real ctx (see docs/PLUGIN_AUTHORING_GUIDE.md
 * §2). This proves the REWRITTEN file:
 *   1. is syntactically valid (`node --check`),
 *   2. passes the real 4-gate static validator,
 *   3. actually loads + activates through the real hardened sandbox
 *      (`loadPluginFromSource`), and
 *   4. its tick/macro behavior does what the header comment claims —
 *      throttled tick, unthrottled manual macro trigger, real
 *      ctx.callMacro round-trips (no fetch, no ctx.createDTU).
 *
 * Run: node --test server/tests/plugin-example-knowledge-weather.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validatePlugin as runValidation } from "../plugins/validator.js";
import { loadPluginFromSource, getPluginMetrics, tickPlugins, unloadPlugin } from "../plugins/loader.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = path.join(HERE, "..", "plugins", "installed", "example-knowledge-weather", "index.js");

function makeState() {
  return { dtus: new Map(), db: null, emergent: {} };
}

function makeRegistry() {
  const macros = new Map();
  return {
    macros,
    register(domain, action, handler) {
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

describe("example-knowledge-weather — syntax + static validator", () => {
  it("node --check passes (valid ESM syntax)", () => {
    // Throws (test fails) on a non-zero exit.
    execFileSync(process.execPath, ["--check", PLUGIN_PATH], { stdio: "pipe" });
  });

  it("passes all 4 static validator gates (shape / namespace / patterns / dependencies)", async () => {
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");
    const mod = await import(pathToFileURL(PLUGIN_PATH).href);

    const result = runValidation(mod, { sourceCode: source });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    for (const gate of result.gates) {
      assert.equal(gate.passed, true, `gate ${gate.name} failed: ${JSON.stringify(gate.errors)}`);
    }
  });

  it("the code region contains none of the broken ctx calls from the earlier draft", () => {
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");
    // These identifiers don't exist on the real ctx (see
    // docs/PLUGIN_AUTHORING_GUIDE.md §2) — the fixed file must not
    // reference them as live calls. The header's own prose legitimately
    // quotes them (backticked, e.g. `ctx.schedule.every(...)`) to document
    // what the earlier draft got wrong and why — that's real, useful
    // documentation, not a violation. So strip the leading top-of-file
    // JSDoc header comment before scanning, and only require the CODE
    // region below it to be clean of live calls to these non-existent
    // members.
    const codeRegion = source.replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
    assert.doesNotMatch(codeRegion, /ctx\.schedule\s*\./);
    assert.doesNotMatch(codeRegion, /ctx\.storage\s*\./);
    assert.doesNotMatch(codeRegion, /ctx\.createDTU\s*\(/);
    assert.doesNotMatch(codeRegion, /(?<!\w)fetch\s*\(/);
    // The stale header claim about a reload route must be gone from the
    // code region too (the header is allowed to mention it exists as prose
    // explaining that the route does NOT exist).
    assert.doesNotMatch(codeRegion, /\/api\/plugins\/reload/);
  });
});

describe("example-knowledge-weather — real end-to-end load through the sandbox", () => {
  it("activates, and its macro + tick round-trip through ctx.callMacro correctly", async () => {
    const STATE = makeState();
    const registry = makeRegistry();
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");

    const macroCalls = [];
    const runMacro = async (domain, name, input) => {
      macroCalls.push({ domain, name, input });
      if (domain === "discovery" && name === "facets") {
        return { ok: true, facets: [{ kind: "note", n: 12 }, { kind: "recipe", n: 4 }] };
      }
      if (domain === "discovery" && name === "trending") {
        return { ok: true, trending: [{ id: "dtu_trend_1", title: "Trending Test DTU", citations: 3 }] };
      }
      if (domain === "dtu" && name === "create") {
        return { ok: true, result: { id: `dtu_new_${macroCalls.length}`, ...input } };
      }
      return { ok: false, error: "unhandled_stub_macro" };
    };

    const result = await loadPluginFromSource(STATE, source, {
      register: registry.register,
      runMacro,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pluginId, "example.knowledge-weather-daily");
    assert.deepEqual(result.macros, ["weather.publish-daily"]);

    const metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 1);
    assert.equal(metrics.plugins[0].hasTick, true);

    // First tick: nothing published yet (store empty) -> should publish.
    const tick1 = await tickPlugins(STATE);
    assert.equal(tick1.ok, true);
    assert.deepEqual(tick1.errors, []);
    assert.equal(tick1.ticked, 1);

    const dtuCreateCalls = () => macroCalls.filter((c) => c.domain === "dtu" && c.name === "create");
    assert.equal(dtuCreateCalls().length, 1, "first tick should have published exactly one DTU");
    assert.ok(macroCalls.some((c) => c.domain === "discovery" && c.name === "facets"));
    assert.ok(macroCalls.some((c) => c.domain === "discovery" && c.name === "trending"));

    const firstBody = dtuCreateCalls()[0].input.body;
    assert.match(firstBody, /Knowledge Weather Report/);
    assert.match(firstBody, /note\s+12 DTUs/);
    assert.match(firstBody, /Trending Test DTU/);

    // Second tick immediately after: throttled by ctx.store, must NOT publish again.
    const tick2 = await tickPlugins(STATE);
    assert.equal(tick2.ok, true);
    assert.equal(dtuCreateCalls().length, 1, "throttled tick must not publish a second DTU within the same day");

    // Manual macro trigger bypasses the throttle by design (see the macro's
    // own comment) — it must publish regardless of the recent tick.
    const manualResult = await registry.run("weather", "publish-daily", {});
    assert.equal(manualResult.ok, true, JSON.stringify(manualResult));
    assert.equal(dtuCreateCalls().length, 2, "manual trigger must publish even though tick was just throttled");

    unloadPlugin(STATE, "example.knowledge-weather-daily");
    assert.equal(getPluginMetrics(STATE).loadedCount, 0);
  });

  it("degrades honestly (does not throw) when discovery macros are unavailable", async () => {
    const STATE = makeState();
    const registry = makeRegistry();
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");

    const runMacro = async (domain, name, input) => {
      if (domain === "dtu" && name === "create") {
        return { ok: true, result: { id: "dtu_degraded_1", ...input } };
      }
      return { ok: false, error: "capability_denied" }; // simulate discovery unreachable
    };

    const result = await loadPluginFromSource(STATE, source, { register: registry.register, runMacro });
    assert.equal(result.ok, true, JSON.stringify(result));

    const macroResult = await registry.run("weather", "publish-daily", {});
    assert.equal(macroResult.ok, true, JSON.stringify(macroResult));
    assert.match(macroResult.result.body, /no facet data available/);
    assert.match(macroResult.result.body, /no trending data available/);

    unloadPlugin(STATE, "example.knowledge-weather-daily");
  });
});
