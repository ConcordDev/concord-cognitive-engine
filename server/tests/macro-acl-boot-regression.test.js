// Regression test for the SEC-MACRO-ACL production boot crash: runMacro
// referenced the module-level `const` Maps MACRO_ACL / MACRO_ACL_DOMAIN
// directly, but they are declared far below runMacro and top-level bootstrap
// code ("BOOTSTRAP GLOBAL EMERGENTS") calls runMacro before those
// declarations execute — "Cannot access 'MACRO_ACL' before initialization"
// escaped as an unhandled rejection and crashed prod in a loop. The fix
// routes the gate through the globalThis.humanMacroAclDenial hook, which is
// installed only after both maps are initialized.
//
// This file boots the REAL server.js (same pattern as tests/boot.test.js:
// dynamic import + registerServerCleanExit). A process 'unhandledRejection'
// listener is registered BEFORE the import so a TDZ rejection escaping the
// un-awaited bootstrap runMacro calls is recorded instead of crashing the
// runner. Then the __TEST__ surface re-runs the boot-style call and checks
// the human gate still denies/enforces correctly. No network: run under
// tests/preload/no-egress.mjs with DATA_DIR pointed at a throwaway temp dir
// (server/data must never be touched).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

// Capture unhandled rejections from the moment the file starts — BEFORE the
// dynamic import below — so a boot-time TDZ rejection (runMacro is async and
// the bootstrap call sites don't await it) surfaces here instead of crashing.
const unhandledRejections = [];
process.on("unhandledRejection", (reason) => {
  unhandledRejections.push(String(reason?.message || reason));
});

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MEMBER_CTX = {
  actor: { userId: "u-test", role: "member", scopes: ["read", "write"] },
  reqMeta: { path: "/api/lens/run", method: "POST" },
};

const ADMIN_CTX = {
  actor: { userId: "u-test", role: "admin", scopes: ["read", "write"] },
  reqMeta: { path: "/api/lens/run", method: "POST" },
};

describe("SEC-MACRO-ACL boot regression (TDZ crash)", () => {
  let __TEST__;

  before(async () => {
    const mod = await import("../server.js");
    _serverMod = mod;
    __TEST__ = mod.__TEST__;
  });

  it("boots server.js with no unhandled 'before initialization' rejection", async () => {
    assert.ok(__TEST__, "server.js must export __TEST__ (module finished evaluating)");
    // Give any bootstrap-time rejection a real chance to surface.
    await sleep(1500);
    const tdz = unhandledRejections.filter((m) => /before initialization/.test(m));
    assert.deepEqual(tdz, [], `TDZ rejections must not occur during boot, got: ${JSON.stringify(tdz)}`);
  });

  it("installs the globalThis.humanMacroAclDenial hook once booted", () => {
    assert.equal(typeof globalThis.humanMacroAclDenial, "function",
      "globalThis.humanMacroAclDenial must be a function after server.js evaluates");
  });

  it("exposes runMacro and makeInternalCtx on the __TEST__ surface", () => {
    assert.equal(typeof __TEST__.runMacro, "function", "__TEST__.runMacro must be exposed");
    assert.equal(typeof __TEST__.makeInternalCtx, "function", "__TEST__.makeInternalCtx must be exposed");
  });

  it("the boot-style internal call resolves (no TDZ throw)", async () => {
    // Exact shape of the BOOTSTRAP GLOBAL EMERGENTS call site that used to
    // hit the dead zone: internal system actor, no reqMeta, no await at the
    // call site.
    await assert.doesNotReject(() => __TEST__.runMacro(
      "emergent", "list", { instanceScope: "global" },
      { actor: { userId: "system", role: "owner", scopes: ["*"] }, internal: true, state: __TEST__.STATE },
    ));
  });

  it("internal callers via makeInternalCtx are not admin_only-denied on webhook.list", async () => {
    const res = await __TEST__.runMacro("webhook", "list", {}, __TEST__.makeInternalCtx("boot-regression"));
    assert.notEqual(res?.code, "admin_only", "internal ctx must bypass the human gate");
  });

  it("a signed-in member is 403-denied on admin-tier webhook.list (gate still enforced)", async () => {
    const res = await __TEST__.runMacro("webhook", "list", {}, MEMBER_CTX);
    assert.equal(res?.ok, false, "member webhook.list must be denied");
    assert.equal(res?.status, 403, "member webhook.list must be a 403");
  });

  it("an admin is NOT admin_only-denied on webhook.list", async () => {
    const res = await __TEST__.runMacro("webhook", "list", {}, ADMIN_CTX);
    assert.notEqual(res?.code, "admin_only", "admin role must not get an admin_only denial");
  });

  it("a member is NOT admin_only-denied on the allowlisted plugin.list", async () => {
    const res = await __TEST__.runMacro("plugin", "list", {}, MEMBER_CTX);
    assert.notEqual(res?.code, "admin_only", "plugin.list is member-usable and must stay open");
  });
});