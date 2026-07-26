/**
 * Plugin API contract version — server/lib/plugin-api-version.js +
 * server/plugins/validator.js Gate 1's apiVersion check.
 *
 * The plugin system previously had no versioned contract for the HOST ctx
 * surface (`buildSandboxedContext`) a plugin depends on — Gate 1 only
 * checked the plugin's OWN semver `version` field, which says nothing about
 * host-surface compatibility. This proves:
 *   1. `isCompatible()`'s semver-major logic in isolation.
 *   2. A plugin declaring the current major (`manifest.apiVersion: "1.0.0"`)
 *      passes Gate 1.
 *   3. A plugin declaring an incompatible major (`"2.5.0"`) FAILS Gate 1
 *      with a clear, actionable `api_version_incompatible` error.
 *   4. A plugin that omits `apiVersion` entirely still passes (regression
 *      safety) — checked against a fresh minimal fixture AND against the
 *      real shipped `example-knowledge-weather` plugin, which predates this
 *      gate and has no manifest at all.
 *
 * Run: node --test server/tests/plugin-api-version.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CURRENT_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  IMPLICIT_LEGACY_API_VERSION,
  isCompatible,
} from "../lib/plugin-api-version.js";
import { validatePlugin as runValidation } from "../plugins/validator.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PLUGIN_PATH = path.join(
  HERE, "..", "plugins", "installed", "example-knowledge-weather", "index.js",
);

function baseFixture(overrides = {}) {
  return {
    id: "fixture.plugin-api-version",
    name: "Fixture Plugin",
    version: "1.0.0",
    init() { return { ok: true }; },
    destroy() {},
    ...overrides,
  };
}

describe("plugin-api-version — isCompatible() semver-major logic", () => {
  it("today's constants are both 1.0.0 (the real, current ctx shape)", () => {
    assert.equal(CURRENT_API_VERSION, "1.0.0");
    assert.equal(MIN_SUPPORTED_API_VERSION, "1.0.0");
    assert.equal(IMPLICIT_LEGACY_API_VERSION, "1.0.0");
  });

  it("accepts an exact major.minor.patch match", () => {
    assert.equal(isCompatible("1.0.0"), true);
  });

  it("accepts any minor/patch within the same major (minor/patch not enforced)", () => {
    assert.equal(isCompatible("1.4.9"), true);
    assert.equal(isCompatible("1.99.0"), true);
  });

  it("rejects a higher incompatible major", () => {
    assert.equal(isCompatible("2.0.0"), false);
    assert.equal(isCompatible("2.5.0"), false);
  });

  it("rejects a lower major below MIN_SUPPORTED_API_VERSION", () => {
    assert.equal(isCompatible("0.9.0"), false);
  });

  it("rejects garbage / non-semver strings", () => {
    assert.equal(isCompatible("not-a-version"), false);
    assert.equal(isCompatible(""), false);
    assert.equal(isCompatible(undefined), false);
    assert.equal(isCompatible(null), false);
    assert.equal(isCompatible(42), false);
  });
});

describe("validator.js Gate 1 — apiVersion compatibility check", () => {
  it("a plugin declaring manifest.apiVersion '1.0.0' passes Gate 1", () => {
    const mod = baseFixture({ manifest: { apiVersion: "1.0.0" } });
    const result = runValidation(mod, {});
    const shapeGate = result.gates.find((g) => g.name === "shape");
    assert.equal(shapeGate.passed, true, JSON.stringify(shapeGate.errors));
  });

  it("a plugin declaring an incompatible major ('2.5.0') FAILS Gate 1 with a clear, actionable error", () => {
    const mod = baseFixture({ manifest: { apiVersion: "2.5.0" } });
    const result = runValidation(mod, {});
    const shapeGate = result.gates.find((g) => g.name === "shape");
    assert.equal(shapeGate.passed, false);
    assert.equal(result.valid, false);

    const apiVersionError = shapeGate.errors.find((e) => e.startsWith("api_version_incompatible"));
    assert.ok(apiVersionError, `expected an api_version_incompatible error, got: ${JSON.stringify(shapeGate.errors)}`);
    // Actionable: names the declared version, the supported range, and where to read more.
    assert.match(apiVersionError, /2\.5\.0/);
    assert.match(apiVersionError, /1\.0\.0/);
    assert.match(apiVersionError, /PLUGIN_API_CONTRACT\.md/);
  });

  it("a plugin omitting apiVersion entirely still passes (regression safety, fresh fixture)", () => {
    const modNoManifest = baseFixture(); // no `manifest` key at all
    const resultNoManifest = runValidation(modNoManifest, {});
    assert.equal(resultNoManifest.gates.find((g) => g.name === "shape").passed, true);

    const modEmptyManifest = baseFixture({ manifest: {} }); // manifest present, apiVersion absent
    const resultEmptyManifest = runValidation(modEmptyManifest, {});
    assert.equal(resultEmptyManifest.gates.find((g) => g.name === "shape").passed, true);
  });

  it("a plugin with an incompatible apiVersion still fails the other 3 gates independently (gates are additive)", () => {
    // Sanity: the new check doesn't swallow or short-circuit the existing
    // shape errors (missing destroy) — both fire in the same gate result.
    const mod = {
      id: "fixture.plugin-api-version-2",
      name: "Fixture Plugin 2",
      version: "1.0.0",
      init() { return { ok: true }; },
      // destroy intentionally omitted
      manifest: { apiVersion: "9.9.9" },
    };
    const result = runValidation(mod, {});
    const shapeGate = result.gates.find((g) => g.name === "shape");
    assert.equal(shapeGate.passed, false);
    assert.ok(shapeGate.errors.includes("missing_destroy_function"));
    assert.ok(shapeGate.errors.some((e) => e.startsWith("api_version_incompatible")));
  });
});

describe("validator.js Gate 1 — real shipped plugin regression safety", () => {
  it("example-knowledge-weather (no manifest at all) still passes all 4 gates", async () => {
    const source = fs.readFileSync(EXAMPLE_PLUGIN_PATH, "utf8");
    const mod = await import(pathToFileURL(EXAMPLE_PLUGIN_PATH).href);

    // Confirm the premise: this real shipped plugin has no manifest/apiVersion,
    // so it exercises the implicit-default path, not an explicit declaration.
    assert.equal(mod.manifest, undefined);

    const result = runValidation(mod, { sourceCode: source });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    for (const gate of result.gates) {
      assert.equal(gate.passed, true, `gate ${gate.name} failed: ${JSON.stringify(gate.errors)}`);
    }
  });
});
