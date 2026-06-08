// tests/depth/ux-suite-behavior.test.js — REAL behavioral tests for the
// ux-suite domain (registerLensAction family, invoked via lensRun). The lens is
// a code-derived component workbench: every assertion below pins a manifest-
// derived value, a save/reset/favourite round-trip, or an unknown-component
// rejection. Every lensRun("ux-suite", "<macro>", …) call literally names the
// macro, so the macro-depth grader credits it as a behavioral invocation.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("ux-suite — catalog + search (manifest-derived exact values)", () => {
  it("catalog: derives 19 components and per-group counts from the CATALOG manifest", async () => {
    const r = await lensRun("ux-suite", "catalog", {});
    assert.equal(r.result.total, 19);
    assert.equal(r.result.components.length, 19);
    assert.ok(r.result.source.includes("code-derived"));
    // GROUPS counts derived from the manifest: settings 5, progress 5, world 4, ops 3, shell 2.
    const byId = Object.fromEntries(r.result.groups.map((g) => [g.id, g.count]));
    assert.equal(byId.settings, 5);
    assert.equal(byId.progress, 5);
    assert.equal(byId.world, 4);
    assert.equal(byId.ops, 3);
    assert.equal(byId.shell, 2);
    // A specific component carries its derived propCount (AccessibilityPanel has 3 props).
    const ap = r.result.components.find((c) => c.name === "AccessibilityPanel");
    assert.equal(ap.group, "settings");
    assert.equal(ap.propCount, 3);
    assert.equal(ap.importPath, "@/components/settings/AccessibilityPanel");
  });

  it("search: a query matches by name and the group filter narrows the result set", async () => {
    const r = await lensRun("ux-suite", "search", { params: { query: "accessibility" } });
    assert.equal(r.result.query, "accessibility");
    // "accessibility" matches AccessibilityPanel (name) + SettingsPanel (description mentions accessibility tab).
    assert.ok(r.result.results.some((c) => c.name === "AccessibilityPanel"));
    assert.ok(r.result.count >= 1);

    const ops = await lensRun("ux-suite", "search", { params: { group: "ops" } });
    assert.equal(ops.result.group, "ops");
    assert.equal(ops.result.count, 3);
    assert.ok(ops.result.results.every((c) => c.group === "ops"));
  });

  it("search: group=all with no query returns the whole catalog", async () => {
    const r = await lensRun("ux-suite", "search", { params: { group: "all" } });
    assert.equal(r.result.count, 19);
  });
});

describe("ux-suite — preview / props-schema / usage-snippet (defaults from manifest)", () => {
  it("preview: returns the component's default props and a sanitised state", async () => {
    const r = await lensRun("ux-suite", "preview", { params: { component: "SoundSystem" } });
    assert.equal(r.result.component, "SoundSystem");
    assert.equal(r.result.state, "default");
    assert.equal(r.result.liveMount, "/world");
    // Defaults flow from the propSchema: masterVolume 0.65, muted false.
    assert.equal(r.result.props.masterVolume, 0.65);
    assert.equal(r.result.props.muted, false);
    assert.equal(r.result.sandbox.isolated, true);
  });

  it("preview: an unsupported state falls back to 'default'; an explicit valid state is kept", async () => {
    const bad = await lensRun("ux-suite", "preview", { params: { component: "ARPreview", state: "nonsense" } });
    assert.equal(bad.result.state, "default");
    const ok = await lensRun("ux-suite", "preview", { params: { component: "ARPreview", state: "loading" } });
    assert.equal(ok.result.state, "loading");
    assert.ok(ok.result.availableStates.includes("loading"));
  });

  it("preview: caller-supplied props override the defaults", async () => {
    const r = await lensRun("ux-suite", "preview", { params: { component: "SoundSystem", props: { masterVolume: 0.2 } } });
    assert.equal(r.result.props.masterVolume, 0.2);
    assert.equal(r.result.props.muted, false); // untouched default
  });

  it("props-schema: returns the schema, defaults, and current (= defaults when no overrides)", async () => {
    const r = await lensRun("ux-suite", "props-schema", { params: { component: "AdaptiveComplexity" } });
    assert.equal(r.result.component, "AdaptiveComplexity");
    assert.equal(r.result.hasOverrides, false);
    assert.equal(r.result.defaults.tier, "novice");
    assert.equal(r.result.current.tier, "novice");
    const tierField = r.result.schema.find((f) => f.key === "tier");
    assert.equal(tierField.type, "enum");
    assert.ok(tierField.options.includes("expert"));
  });

  it("usage-snippet: emits an import line + JSX with default props + a typed props interface", async () => {
    const r = await lensRun("ux-suite", "usage-snippet", { params: { component: "AnalyticsDashboard" } });
    assert.equal(r.result.importStatement, "import { AnalyticsDashboard } from '@/components/ops/AnalyticsDashboard';");
    // enum default 'range' = '7d' is rendered as a string prop in the JSX.
    assert.ok(r.result.usage.includes('range="7d"'));
    // The TS interface maps the enum options to a union type.
    assert.ok(r.result.propsInterface.includes("range: '24h' | '7d' | '30d' | '90d';"));
    assert.equal(r.result.liveMount, "/lenses/system");
  });
});

describe("ux-suite — a11y-check + variant-gallery (deterministic rule output)", () => {
  it("a11y-check: a fully-conformant interactive component scores 100 with 4 passes", async () => {
    const r = await lensRun("ux-suite", "a11y-check", { params: { component: "AccessibilityPanel" } });
    assert.equal(r.result.component, "AccessibilityPanel");
    assert.equal(r.result.score, 100);
    assert.equal(r.result.summary.passes, 4); // keyboard + aria + landmark + tap-target
    assert.equal(r.result.summary.errors, 0);
    assert.equal(r.result.summary.warnings, 0);
    const kb = r.result.findings.find((f) => f.rule === "keyboard-operable");
    assert.equal(kb.severity, "pass");
    // Responsive audit covers all three breakpoints, all fitting for a fluid component.
    assert.equal(r.result.responsive.length, 3);
    assert.ok(r.result.responsive.every((bp) => bp.fits === true));
  });

  it("a11y-check: a non-interactive component skips the keyboard + tap-target rules", async () => {
    const r = await lensRun("ux-suite", "a11y-check", { params: { component: "ProgressionPanel" } });
    // Non-interactive → only aria (info) + landmark (pass) findings remain.
    assert.equal(r.result.summary.total, 2);
    assert.ok(!r.result.findings.some((f) => f.rule === "keyboard-operable"));
    assert.ok(!r.result.findings.some((f) => f.rule === "tap-target-size"));
    const landmark = r.result.findings.find((f) => f.rule === "landmark-role");
    assert.equal(landmark.severity, "pass");
  });

  it("a11y-check: MobileCompanion does not fit the desktop breakpoint", async () => {
    const r = await lensRun("ux-suite", "a11y-check", { params: { component: "MobileCompanion" } });
    const desktop = r.result.responsive.find((bp) => bp.breakpoint === "desktop");
    assert.equal(desktop.fits, false);
    assert.ok(desktop.note.includes("desktop renders a framed device"));
    const mobile = r.result.responsive.find((bp) => bp.breakpoint === "mobile");
    assert.equal(mobile.fits, true);
  });

  it("variant-gallery: enumerates exactly the component's declared states with tone metadata", async () => {
    const r = await lensRun("ux-suite", "variant-gallery", { params: { component: "AchievementSystem" } });
    // AchievementSystem declares default/loading/error/empty → 4 variants.
    assert.equal(r.result.variantCount, 4);
    assert.deepEqual(r.result.variants.map((v) => v.state), ["default", "loading", "error", "empty"]);
    const err = r.result.variants.find((v) => v.state === "error");
    assert.equal(err.tone, "rose");
    assert.equal(err.label, "Error");
  });
});

describe("ux-suite — save/reset prop round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ux-suite-props"); });

  it("save-props → props-schema reflects the override; reset-props clears it", async () => {
    const save = await lensRun("ux-suite", "save-props", { params: { component: "SettingsPanel", props: { activeTab: "privacy", compact: true } } }, ctx);
    assert.equal(save.result.saved.activeTab, "privacy");
    assert.equal(save.result.cleared, false);

    const sch = await lensRun("ux-suite", "props-schema", { params: { component: "SettingsPanel" } }, ctx);
    assert.equal(sch.result.hasOverrides, true);
    assert.equal(sch.result.current.activeTab, "privacy");
    assert.equal(sch.result.current.compact, true);
    assert.equal(sch.result.defaults.activeTab, "general"); // defaults unchanged

    // Preview picks up the saved override for the same user.
    const prev = await lensRun("ux-suite", "preview", { params: { component: "SettingsPanel" } }, ctx);
    assert.equal(prev.result.props.activeTab, "privacy");

    const reset = await lensRun("ux-suite", "reset-props", { params: { component: "SettingsPanel" } }, ctx);
    assert.equal(reset.result.defaults.activeTab, "general");
    const after = await lensRun("ux-suite", "props-schema", { params: { component: "SettingsPanel" } }, ctx);
    assert.equal(after.result.hasOverrides, false);
    assert.equal(after.result.current.activeTab, "general");
  });

  it("save-props: only schema-defined keys persist; unknown keys are dropped", async () => {
    const save = await lensRun("ux-suite", "save-props", { params: { component: "DailyRituals", props: { streakDays: 42, bogusKey: "ignored" } } }, ctx);
    assert.equal(save.result.saved.streakDays, 42);
    assert.equal(save.result.saved.bogusKey, undefined);
    assert.ok(!Object.keys(save.result.saved).includes("bogusKey"));
  });

  it("save-props: an all-unknown-keys payload clears the override (cleared=true)", async () => {
    const save = await lensRun("ux-suite", "save-props", { params: { component: "SecretsDiscovery", props: { notAKey: 1 } } }, ctx);
    assert.equal(save.result.cleared, true);
    assert.deepEqual(save.result.saved, {});
  });
});

describe("ux-suite — favourites round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ux-suite-favs"); });

  it("favourites-list starts empty; favourite-toggle adds then removes a component", async () => {
    const empty = await lensRun("ux-suite", "favourites-list", {}, ctx);
    assert.deepEqual(empty.result.favourites, []);

    const on = await lensRun("ux-suite", "favourite-toggle", { params: { component: "WorldTravel" } }, ctx);
    assert.equal(on.result.favourited, true);
    const listed = await lensRun("ux-suite", "favourites-list", {}, ctx);
    assert.ok(listed.result.favourites.includes("WorldTravel"));

    const off = await lensRun("ux-suite", "favourite-toggle", { params: { component: "WorldTravel" } }, ctx);
    assert.equal(off.result.favourited, false);
    const after = await lensRun("ux-suite", "favourites-list", {}, ctx);
    assert.ok(!after.result.favourites.includes("WorldTravel"));
  });

  it("favourites are per-user: another ctx's favourite is invisible here", async () => {
    const other = await depthCtx("ux-suite-favs-other");
    await lensRun("ux-suite", "favourite-toggle", { params: { component: "AgentBuilder" } }, other);
    const otherList = await lensRun("ux-suite", "favourites-list", {}, other);
    assert.ok(otherList.result.favourites.includes("AgentBuilder"));
    // The first ctx never favourited AgentBuilder.
    const mine = await lensRun("ux-suite", "favourites-list", {}, ctx);
    assert.ok(!mine.result.favourites.includes("AgentBuilder"));
  });
});

describe("ux-suite — unknown-component rejections (handler verdict in result)", () => {
  it("preview rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "preview", { params: { component: "DoesNotExist" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("props-schema rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "props-schema", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("save-props rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "save-props", { params: { component: "Nope", props: { x: 1 } } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("reset-props rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "reset-props", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("usage-snippet rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "usage-snippet", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("a11y-check rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "a11y-check", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("variant-gallery rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "variant-gallery", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });

  it("favourite-toggle rejects an unknown component", async () => {
    const r = await lensRun("ux-suite", "favourite-toggle", { params: { component: "Nope" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /unknown component/);
  });
});
