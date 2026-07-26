/**
 * Plugin gallery honesty pass (2026-07-24) — capability disclosure, honest
 * trust labeling, and the admin takedown path (`delistPlugin`).
 *
 * User-approved scope: "lightweight automated gate + honest labeling" over a
 * full human-review queue. `trusted` still means only "self-signed with a
 * key the SAME account registered for itself" — these tests pin that the
 * NEW fields tell the truth about that, rather than implying review:
 *
 *   - `declaredCapabilities` on every gallery entry is sourced from the SAME
 *     manifest `installFromGallery` actually forwards to the loader's
 *     confinement (`buildSandboxedContext`/`makeConfinedCtx`) — never a
 *     hand-maintained parallel description.
 *   - `trustDescription` is always present alongside the untouched `trusted`
 *     boolean and accurately reflects it.
 *   - `delistPlugin` removes an entry from `listGallery` but not from a
 *     direct `getGalleryEntry` lookup (audit trail), and stops a currently
 *     loaded plugin by reusing the loader's own `unloadPlugin`.
 *
 * Run: node --test --test-force-exit --test-timeout=60000 server/tests/plugin-gallery-disclosure.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  publishPlugin,
  installFromGallery,
  getGalleryEntry,
  listGallery,
  delistPlugin,
} from "../lib/plugin-gallery.js";
import { getPluginMetrics, unloadPlugin, DEFAULT_PLUGIN_MACRO_GRANTS } from "../plugins/loader.js";

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

function pluginSource(id, macroDomain) {
  return `
    export const id = "${id}";
    export const name = "${id}";
    export const version = "1.0.0";
    export function init(ctx) { ctx.log("info", "up"); return { ok: true }; }
    export function destroy() {}
    export const macros = {
      "${macroDomain}.ping": async (ctx) => ({ ok: true, pong: true }),
    };
  `;
}

describe("capability disclosure — declaredCapabilities mirrors the enforced manifest", () => {
  let STATE;
  let registry;

  beforeEach(() => {
    STATE = makeState();
    registry = makeRegistry();
  });

  it("a publisher who declares nothing gets the loader's own default grants, not a re-typed copy", () => {
    const pub = publishPlugin({
      pluginId: "gallery.disclosure-default",
      authorId: "author1",
      source: pluginSource("example.disclosure-default", "disclosuredefault"),
    });
    assert.equal(pub.ok, true);
    assert.deepEqual(pub.plugin.declaredCapabilities, [...DEFAULT_PLUGIN_MACRO_GRANTS]);
    assert.ok(Array.isArray(pub.plugin.declaredCapabilities) && pub.plugin.declaredCapabilities.length > 0);
  });

  it("a publisher-declared manifest is what's shown AND what's actually enforced at install time", async () => {
    // This plugin's own macros call OUT via ctx.callMacro — the real path
    // through buildSandboxedContext's confined runMacro — so we can prove
    // the declared manifest is what's actually enforced, not just displayed.
    const source = `
      export const id = "example.disclosure-enforced";
      export const name = "example.disclosure-enforced";
      export const version = "1.0.0";
      export function init() { return { ok: true }; }
      export function destroy() {}
      export const macros = {
        "disclosureenforced.callGranted": async (ctx) => ctx.callMacro("music", "list", {}),
        "disclosureenforced.callDenied": async (ctx) => ctx.callMacro("dtu", "create", {}),
      };
    `;
    const pub = publishPlugin({
      pluginId: "gallery.disclosure-custom",
      authorId: "author1",
      manifest: { macros: ["music.list", "art.search"] },
      source,
    });
    assert.equal(pub.ok, true);
    assert.deepEqual(pub.plugin.declaredCapabilities, ["music.list", "art.search"]);

    const fakeRunMacro = async (domain, name) => ({ ok: true, domain, name });

    const install = await installFromGallery(STATE, "gallery.disclosure-custom", "user1", {
      register: registry.register,
      runMacro: fakeRunMacro,
    });
    assert.equal(install.ok, true, JSON.stringify(install));

    // Granted by the declared manifest ("music.list") — reaches the real runMacro.
    const grantedResult = await registry.run("disclosureenforced", "callGranted", {});
    assert.equal(grantedResult.ok, true, JSON.stringify(grantedResult));
    assert.equal(grantedResult.domain, "music");

    // NOT in the declared manifest ("dtu.create") — the confined ctx built
    // from this exact manifest must deny it, proving disclosure == enforcement.
    const deniedResult = await registry.run("disclosureenforced", "callDenied", {});
    assert.equal(deniedResult.ok, false, JSON.stringify(deniedResult));
    assert.equal(deniedResult.error, "capability_denied");

    unloadPlugin(STATE, "example.disclosure-enforced");
  });

  it("a malformed manifest.macros degrades to the safe default rather than a wider grant", () => {
    const pub = publishPlugin({
      pluginId: "gallery.disclosure-malformed",
      authorId: "author1",
      manifest: { macros: [123, null, "", "   ", "valid.one"] },
      source: pluginSource("example.disclosure-malformed", "disclosuremalformed"),
    });
    assert.equal(pub.ok, true);
    assert.deepEqual(pub.plugin.declaredCapabilities, ["valid.one"]);
  });

  it("an empty manifest.macros array falls back to the default grant set", () => {
    const pub = publishPlugin({
      pluginId: "gallery.disclosure-empty",
      authorId: "author1",
      manifest: { macros: [] },
      source: pluginSource("example.disclosure-empty", "disclosureempty"),
    });
    assert.equal(pub.ok, true);
    assert.deepEqual(pub.plugin.declaredCapabilities, [...DEFAULT_PLUGIN_MACRO_GRANTS]);
  });

  it("declaredCapabilities is present on listGallery and getGalleryEntry, not just the publish response", () => {
    publishPlugin({
      pluginId: "gallery.disclosure-list",
      authorId: "author1",
      manifest: { macros: ["glyph-spells.list"] },
      source: pluginSource("example.disclosure-list", "disclosurelist"),
    });

    const entry = getGalleryEntry("gallery.disclosure-list");
    assert.deepEqual(entry.plugin.declaredCapabilities, ["glyph-spells.list"]);

    const list = listGallery({ search: "disclosure-list" });
    const found = list.plugins.find((p) => p.pluginId === "gallery.disclosure-list");
    assert.ok(found, "published plugin should be listed");
    assert.deepEqual(found.declaredCapabilities, ["glyph-spells.list"]);
  });
});

describe("honest trust labeling — trustDescription is always present and matches `trusted`", () => {
  it("an unsigned publish gets trusted:false + an honest unsigned description, `trusted` itself untouched", () => {
    const pub = publishPlugin({
      pluginId: "gallery.trust-unsigned",
      authorId: "author1",
      source: pluginSource("example.trust-unsigned", "trustunsigned"),
    });
    assert.equal(pub.ok, true);
    assert.equal(pub.plugin.trusted, false);
    assert.equal(typeof pub.plugin.trustDescription, "string");
    assert.ok(pub.plugin.trustDescription.length > 0);
    assert.ok(!/independently reviewed/.test(pub.plugin.trustDescription) || /not independently reviewed/i.test(pub.plugin.trustDescription));
    assert.match(pub.plugin.trustDescription, /not independently reviewed/i);
    assert.doesNotMatch(pub.plugin.trustDescription, /self-attested/i);
  });

  it("trustDescription is present on listGallery and getGalleryEntry entries too", () => {
    publishPlugin({
      pluginId: "gallery.trust-list",
      authorId: "author1",
      source: pluginSource("example.trust-list", "trustlist"),
    });
    const entry = getGalleryEntry("gallery.trust-list");
    assert.equal(typeof entry.plugin.trustDescription, "string");
    const list = listGallery({ search: "trust-list" });
    const found = list.plugins.find((p) => p.pluginId === "gallery.trust-list");
    assert.equal(typeof found.trustDescription, "string");
  });
});

describe("delistPlugin — the admin takedown path", () => {
  let STATE;
  let registry;

  beforeEach(() => {
    STATE = makeState();
    registry = makeRegistry();
  });

  it("plugin_not_found for an id that was never published", () => {
    const result = delistPlugin("gallery.delist-does-not-exist", "admin1", "spam");
    assert.equal(result.ok, false);
    assert.equal(result.error, "plugin_not_found");
  });

  it("delisting removes an entry from listGallery but getGalleryEntry still returns it, with the delisted fields visible", () => {
    publishPlugin({
      pluginId: "gallery.delist-basic",
      authorId: "author1",
      source: pluginSource("example.delist-basic", "delistbasic"),
    });

    const beforeList = listGallery({ search: "delist-basic" });
    assert.ok(beforeList.plugins.some((p) => p.pluginId === "gallery.delist-basic"));

    const result = delistPlugin("gallery.delist-basic", "admin1", "policy_violation");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.plugin.delistedReason, "policy_violation");
    assert.equal(typeof result.plugin.delistedAt, "string");

    const afterList = listGallery({ search: "delist-basic" });
    assert.equal(afterList.plugins.some((p) => p.pluginId === "gallery.delist-basic"), false, "delisted entry must not appear in listGallery");

    const direct = getGalleryEntry("gallery.delist-basic");
    assert.equal(direct.ok, true, "direct lookup by id must still succeed for audit");
    assert.equal(direct.plugin.delistedReason, "policy_violation");
    assert.equal(typeof direct.plugin.delistedAt, "string");
  });

  it("delisting a currently-loaded plugin actually stops it (verified via getPluginMetrics)", async () => {
    publishPlugin({
      pluginId: "gallery.delist-running",
      authorId: "author1",
      source: pluginSource("example.delist-running", "delistrunning"),
    });

    const install = await installFromGallery(STATE, "gallery.delist-running", "user1", {
      register: registry.register,
      runMacro: async () => ({ ok: true }),
    });
    assert.equal(install.ok, true, JSON.stringify(install));

    let metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 1, "plugin should be running before delist");

    const result = delistPlugin("gallery.delist-running", "admin1", "malicious_behavior", { STATE });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.unloaded, true, "delistPlugin should report it stopped the running plugin");

    metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 0, "the loader must no longer have this plugin loaded after delist");
  });

  it("delisting a never-installed plugin reports unloaded:null (nothing to stop)", () => {
    publishPlugin({
      pluginId: "gallery.delist-never-run",
      authorId: "author1",
      source: pluginSource("example.delist-never-run", "delistneverrun"),
    });
    const result = delistPlugin("gallery.delist-never-run", "admin1", "reason", { STATE: makeState() });
    assert.equal(result.ok, true);
    assert.equal(result.unloaded, null);
  });

  it("delisting is idempotent — a second call preserves the original reason/timestamp", () => {
    publishPlugin({
      pluginId: "gallery.delist-idempotent",
      authorId: "author1",
      source: pluginSource("example.delist-idempotent", "delistidempotent"),
    });

    const first = delistPlugin("gallery.delist-idempotent", "admin1", "first_reason");
    assert.equal(first.ok, true);

    const second = delistPlugin("gallery.delist-idempotent", "admin2", "second_reason_should_be_ignored");
    assert.equal(second.ok, true);
    assert.equal(second.alreadyDelisted, true);
    assert.equal(second.plugin.delistedReason, "first_reason", "re-delisting must not overwrite the original reason");
    assert.equal(second.plugin.delistedAt, first.plugin.delistedAt, "re-delisting must not overwrite the original timestamp");
  });

  it("installFromGallery rejects a delisted plugin honestly instead of silently reloading it", async () => {
    publishPlugin({
      pluginId: "gallery.delist-blocks-install",
      authorId: "author1",
      source: pluginSource("example.delist-blocks-install", "delistblocksinstall"),
    });
    delistPlugin("gallery.delist-blocks-install", "admin1", "takedown");

    const result = await installFromGallery(STATE, "gallery.delist-blocks-install", "user1", {
      register: registry.register,
      runMacro: async () => ({ ok: true }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "plugin_delisted");
    assert.equal(result.reason, "takedown");

    const metrics = getPluginMetrics(STATE);
    assert.equal(metrics.loadedCount, 0, "a delisted plugin must never be loaded via install");
  });
});
