/**
 * Item 5 contract tests — installed/emergent-gen plugin code now runs through the
 * Phase-2 confined ctx. A plugin's callMacro reaches ONLY the macros its manifest
 * grants; forbidden domains (code/repair/admin/config) are denied regardless;
 * default-deny applies when the manifest omits a domain.
 *
 * Run: node --test server/tests/plugin-confinement.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSandboxedContext } from "../plugins/loader.js";

const fakeRun = async (d, n) => ({ ok: true, result: `${d}.${n}` });
const STATE = { dtus: new Map(), db: null };

describe("plugin callMacro is confined by its manifest", () => {
  it("allows manifest-granted macros and denies the rest (default-deny)", async () => {
    const ctx = buildSandboxedContext(STATE, "p1", { runMacro: fakeRun, manifest: { macros: ["dtu.*", "discovery.search"] } });
    assert.equal((await ctx.callMacro("dtu", "create", {})).ok, true);
    assert.equal((await ctx.callMacro("discovery", "search", {})).ok, true);
    const ungranted = await ctx.callMacro("discovery", "trending", {});
    assert.equal(ungranted.ok, false);
    assert.equal(ungranted.error, "capability_denied");
    const notInManifest = await ctx.callMacro("music", "play", {});
    assert.equal(notInManifest.ok, false);
  });

  it("denies forbidden/operator domains even if a malicious manifest grants them", async () => {
    const ctx = buildSandboxedContext(STATE, "p2", { runMacro: fakeRun, manifest: { macros: ["code.*", "repair.*", "admin.*"] } });
    for (const [d, n] of [["code", "exec"], ["repair", "force"], ["admin", "x"]]) {
      const r = await ctx.callMacro(d, n, {});
      assert.equal(r.ok, false, `${d}.${n} denied`);
      assert.equal(r.error, "capability_denied");
    }
  });

  it("applies a sane default manifest (read-only creative/knowledge) when none declared", async () => {
    const ctx = buildSandboxedContext(STATE, "p3", { runMacro: fakeRun });
    assert.equal((await ctx.callMacro("art", "aic-search", {})).ok, true);   // art.* default
    assert.equal((await ctx.callMacro("code", "exec", {})).ok, false);        // forbidden
  });

  it("returns macro_runner_not_available when no runner is wired", async () => {
    const ctx = buildSandboxedContext(STATE, "p4", {});
    assert.equal((await ctx.callMacro("dtu", "create", {})).error, "macro_runner_not_available");
  });
});
