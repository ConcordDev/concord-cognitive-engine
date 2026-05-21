// Contract tests for server/domains/ux-suite.js — the component
// workbench backend (Storybook-parity macros). Every macro is
// pure-compute or in-memory state; no network. Exercises each macro
// and asserts the { ok } envelope shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUxSuiteActions from "../domains/ux-suite.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ux-suite.${name}`);
  if (!fn) throw new Error(`ux-suite.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  registerUxSuiteActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "ux_user_a" }, userId: "ux_user_a" };

describe("ux-suite.catalog (auto-generated)", () => {
  it("derives the component catalog from the manifest", () => {
    const r = call("catalog", ctxA);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.components));
    assert.ok(r.result.components.length > 0);
    assert.ok(Array.isArray(r.result.groups));
    assert.equal(r.result.total, r.result.components.length);
    assert.match(r.result.source, /code-derived/);
  });

  it("every group count sums to the component total", () => {
    const r = call("catalog", ctxA).result;
    const sum = r.groups.reduce((a, g) => a + g.count, 0);
    assert.equal(sum, r.total);
  });
});

describe("ux-suite.search", () => {
  it("filters by free-text query", () => {
    const r = call("search", ctxA, { query: "settings" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.results.every((c) =>
      `${c.name}${c.description}${c.group}${c.homeLabel}`.toLowerCase().includes("settings")));
  });

  it("filters by group", () => {
    const r = call("search", ctxA, { group: "world" });
    assert.equal(r.ok, true);
    assert.ok(r.result.results.every((c) => c.group === "world"));
  });

  it("empty query returns the full catalog", () => {
    const r = call("search", ctxA, {});
    const cat = call("catalog", ctxA).result;
    assert.equal(r.result.count, cat.total);
  });
});

describe("ux-suite.preview", () => {
  it("returns a sandbox descriptor for a known component", () => {
    const r = call("preview", ctxA, { component: "AccessibilityPanel" });
    assert.equal(r.ok, true);
    assert.equal(r.result.component, "AccessibilityPanel");
    assert.ok(r.result.sandbox.isolated);
    assert.ok("props" in r.result);
  });

  it("falls back to default state for an invalid state", () => {
    const r = call("preview", ctxA, { component: "AccessibilityPanel", state: "nonsense" });
    assert.equal(r.result.state, "default");
  });

  it("rejects an unknown component", () => {
    const r = call("preview", ctxA, { component: "NotARealThing" });
    assert.equal(r.ok, false);
  });
});

describe("ux-suite.props-schema", () => {
  it("returns the controls schema + defaults", () => {
    const r = call("props-schema", ctxA, { component: "SoundSystem" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.schema));
    assert.ok("defaults" in r.result);
    assert.ok("current" in r.result);
  });
});

describe("ux-suite.save-props / reset-props", () => {
  it("persists schema-valid prop overrides", () => {
    const r = call("save-props", ctxA, { component: "SoundSystem", props: { masterVolume: 0.3, bogus: 9 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.saved.masterVolume, 0.3);
    assert.ok(!("bogus" in r.result.saved));
  });

  it("saved overrides surface in props-schema.current", () => {
    call("save-props", ctxA, { component: "SoundSystem", props: { muted: true } });
    const r = call("props-schema", ctxA, { component: "SoundSystem" });
    assert.equal(r.result.current.muted, true);
    assert.equal(r.result.hasOverrides, true);
  });

  it("reset clears overrides back to defaults", () => {
    call("save-props", ctxA, { component: "SoundSystem", props: { muted: true } });
    const r = call("reset-props", ctxA, { component: "SoundSystem" });
    assert.equal(r.ok, true);
    const after = call("props-schema", ctxA, { component: "SoundSystem" });
    assert.equal(after.result.hasOverrides, false);
  });
});

describe("ux-suite.usage-snippet", () => {
  it("returns import + JSX usage + props interface", () => {
    const r = call("usage-snippet", ctxA, { component: "AnalyticsDashboard" });
    assert.equal(r.ok, true);
    assert.match(r.result.importStatement, /import \{ AnalyticsDashboard \}/);
    assert.match(r.result.usage, /<AnalyticsDashboard/);
    assert.ok(r.result.propsInterface.length > 0);
  });
});

describe("ux-suite.a11y-check", () => {
  it("produces a deterministic rule-based audit", () => {
    const r = call("a11y-check", ctxA, { component: "AccessibilityPanel" });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.score === "number");
    assert.ok(Array.isArray(r.result.findings));
    assert.ok(Array.isArray(r.result.responsive));
    assert.equal(r.result.responsive.length, 3);
  });

  it("flags MobileCompanion as not fitting desktop", () => {
    const r = call("a11y-check", ctxA, { component: "MobileCompanion" });
    const desktop = r.result.responsive.find((b) => b.breakpoint === "desktop");
    assert.equal(desktop.fits, false);
  });
});

describe("ux-suite.variant-gallery", () => {
  it("returns one variant per declared state", () => {
    const r = call("variant-gallery", ctxA, { component: "AchievementSystem" });
    assert.equal(r.ok, true);
    assert.equal(r.result.variantCount, r.result.variants.length);
    assert.ok(r.result.variants.every((v) => v.state && v.label));
  });
});

describe("ux-suite.favourites", () => {
  it("toggle adds then removes a favourite", () => {
    const on = call("favourite-toggle", ctxA, { component: "WorldTravel" });
    assert.equal(on.ok, true);
    assert.equal(on.result.favourited, true);
    let list = call("favourites-list", ctxA).result.favourites;
    assert.ok(list.includes("WorldTravel"));
    const off = call("favourite-toggle", ctxA, { component: "WorldTravel" });
    assert.equal(off.result.favourited, false);
    list = call("favourites-list", ctxA).result.favourites;
    assert.ok(!list.includes("WorldTravel"));
  });
});

describe("ux-suite invariants", () => {
  it("every macro never throws on bad input + returns ok shape", () => {
    for (const name of ["catalog", "search", "preview", "props-schema",
      "save-props", "reset-props", "usage-snippet", "a11y-check",
      "variant-gallery", "favourites-list", "favourite-toggle"]) {
      const r = call(name, ctxA, { component: "" });
      assert.ok(typeof r.ok === "boolean", `${name} returned ok boolean`);
    }
  });
});
