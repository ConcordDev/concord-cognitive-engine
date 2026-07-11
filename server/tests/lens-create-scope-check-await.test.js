// tests/lens-create-scope-check-await.test.js
//
// Regression guard for a platform-wide `lens.create` outage: the scope-check
// IIFE in `register("lens", "create", …)` (server.js) called
// `ctx.macro.run("emergent", "bridge.lensScope", …)` without awaiting it.
// `ctx.macro.run` is `(domain, name, input) => runMacro(...)`, and
// `runMacro` is an `async function` — so the call ALWAYS returns a Promise,
// even though the `bridge.lensScope` handler itself resolves synchronously.
// The un-awaited IIFE captured that Promise object as `scopeCheck` (always
// truthy), then read `.allowed` off of it (always undefined on a bare
// Promise), so `!scopeCheck.allowed` was always `true` and every
// `lens.create` call returned `{ ok:false, error:"scope_denied" }`
// unconditionally — regardless of the artifact's real scope.
//
// This is the generic artifact-creation path every lens without a bespoke
// domain create macro relies on: `useCreateArtifact()` (frontend) ->
// `POST /api/lens/:domain` -> `runMacro("lens","create",...)`. The bug was
// previously known and explicitly deferred (see the comment in
// tests/lens-artifact-authz.test.js's `makeArtifact` helper, which routes
// around `lens.create` specifically because of this defect) — this test
// closes it out for real instead of continuing to route around it.
//
// Found live (not just grepped) while wiring the council lens's real
// "Simulate Budget" button, which calls `lens.update` -> the same
// generic-artifact-runtime family this bug lives in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

test("lens.create scope check is awaited", async (t) => {
  const { runMacro, makeInternalCtx } = await load();

  // `lens.create`'s scope-check calls `ctx.macro.run(...)` — that's only
  // populated by `makeCtx(req)` (real HTTP requests) or `makeInternalCtx`
  // (server-side internal callers), never by a bare hand-built ctx object.
  // Build on makeInternalCtx so `ctx.macro.run` genuinely resolves, then
  // override actor fields to model a real, non-internal member actor with
  // the scope this test wants — internal:true would bypass macro ACLs
  // entirely, which would mask the exact bug this test exists to pin.
  function ctxFor(userId, scope = "local", role = "member") {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, scope, role, scopes: ["*"] };
    ctx.internal = false;
    return ctx;
  }

  await t.test("a normal local-scope create succeeds (was always scope_denied before the fix)", async () => {
    const r = await runMacro(
      "lens",
      "create",
      { domain: "security", type: "incident", title: "Test incident", data: { rootCause: "test" } },
      ctxFor("scope-check-owner")
    );
    assert.equal(r.ok, true, `expected create to succeed, got: ${JSON.stringify(r)}`);
    assert.ok(r.artifact?.id, "a created artifact must carry a real id");
    assert.equal(r.artifact.title, "Test incident");
  });

  await t.test("a global-scope artifact from a local-scope actor is still correctly denied (real scope enforcement still works)", async () => {
    const r = await runMacro(
      "lens",
      "create",
      { domain: "security", type: "incident", title: "Should be denied", data: {}, meta: { scope: "global" } },
      ctxFor("scope-check-local-actor", "local")
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "scope_denied");
  });

  await t.test("a global-scope artifact from a global-scope actor is allowed", async () => {
    const r = await runMacro(
      "lens",
      "create",
      { domain: "security", type: "incident", title: "Global-scope create", data: {}, meta: { scope: "global" } },
      ctxFor("scope-check-global-actor", "global")
    );
    assert.equal(r.ok, true, `expected global-scope actor to be allowed, got: ${JSON.stringify(r)}`);
  });
});
