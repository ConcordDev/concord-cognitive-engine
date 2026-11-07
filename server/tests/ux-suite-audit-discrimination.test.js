// S-UX-1 pins: the audit discriminates. The pass's discriminating test
// (fontScale 0.75 changes the output; the error state scores
// differently from default) is encoded here, plus the honest fallback:
// no configuration, no score.

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

const ctxA = { actor: { userId: "user_ux_a" }, userId: "user_ux_a" };
const DEFAULTS = { fontScale: 1, reduceMotion: false, highContrast: false };

describe("ux-suite a11y discrimination (S-UX-1)", () => {
  it("the default configuration scores 100 over configuration findings", () => {
    const r = call("a11y-check", ctxA, { component: "AccessibilityPanel", props: { ...DEFAULTS }, state: "default" });
    assert.equal(r.result.score, 100);
    assert.equal(r.result.basis, "configuration");
    assert.match(r.result.scoreFormula, /configuration findings only/);
  });

  it("fontScale 0.75 CHANGES the audit — a warning appears and the score drops", () => {
    const r = call("a11y-check", ctxA, { component: "AccessibilityPanel", props: { ...DEFAULTS, fontScale: 0.75 }, state: "default" });
    const f = r.result.findings.find((x) => x.rule === "text-scale-legibility");
    assert.equal(f.severity, "warn");
    assert.match(f.detail, /0\.75/);
    assert.ok(r.result.score < 100, `score moved: ${r.result.score}`);
  });

  it("the error state scores differently from default", () => {
    const dflt = call("a11y-check", ctxA, { component: "AccessibilityPanel", props: { ...DEFAULTS }, state: "default" });
    const err = call("a11y-check", ctxA, { component: "AccessibilityPanel", props: { ...DEFAULTS }, state: "error" });
    assert.notEqual(err.result.score, dflt.result.score);
    assert.ok(err.result.findings.some((x) => x.rule === "error-state-announcement" && x.severity === "warn"));
  });

  it("without a configuration there is NO score — declarations only, labelled", () => {
    const r = call("a11y-check", ctxA, { component: "AccessibilityPanel" });
    assert.equal(r.result.score, null);
    assert.match(r.result.scoreNote, /No score/);
    assert.ok(r.result.declarations.every((d) => d.basis === "catalog-declaration"));
  });

  it("catalogue truth: 19 components, real import paths, MobileCompanion's home is the Root lens", () => {
    const r = call("catalog", ctxA, {});
    const comps = r.result.components || r.result.catalog || [];
    assert.equal(comps.length, 19);
    for (const c of comps) {
      assert.ok(!c.importPath.includes("components/settings/AccessibilityPanel"), `${c.name} path corrected`);
    }
    const mc = comps.find((c) => c.name === "MobileCompanion");
    assert.equal(mc.homePath, "/lenses/root");
  });
});
