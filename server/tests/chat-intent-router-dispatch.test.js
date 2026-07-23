/**
 * Chat Intent Router — dispatch-path regression test (RQ3 fix).
 *
 * RQ3's original chat.respond integration called
 * `runMacro("math", "naturalQuery", { query }, ctx)`. That always throws
 * ("macro not found: math.naturalQuery") because `naturalQuery` is registered
 * via `registerLensAction` (server.js's LENS_ACTIONS map), not the plain
 * `register()`/MACROS map runMacro() dispatches through — see
 * server/domains/math.js's `registerLensAction("math", "naturalQuery", ...)`
 * vs. runMacro()'s `MACROS.get(domain)` lookup. The call was wrapped in
 * `.catch(() => null)`, so the bug was silent: the ground-truth block server.js
 * builds around this call never actually populated, every time, with no error
 * surfaced anywhere.
 *
 * This test boots the real server (in-memory, via the depth harness) and
 * exercises the EXACT dispatch shape server.js's fixed chat.respond code now
 * uses — `LENS_ACTIONS.get("math.naturalQuery")` + a virtual artifact — so a
 * regression back to the runMacro() call (or any other dispatch break) fails
 * here instead of silently no-op'ing again in production.
 *
 * Run: node --test tests/chat-intent-router-dispatch.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

describe("math.naturalQuery — real LENS_ACTIONS dispatch (RQ3 chat-integration fix)", () => {
  it("is registered under LENS_ACTIONS, not MACROS (confirms the bug's root cause)", async () => {
    const { LENS_ACTIONS, MACROS } = await load();
    assert.ok(LENS_ACTIONS.get("math.naturalQuery"), "expected math.naturalQuery in LENS_ACTIONS");
    assert.ok(!MACROS.get("math")?.get("naturalQuery"), "math.naturalQuery must NOT be in MACROS — runMacro() would never find it");
  });

  it("resolves a real arithmetic query through the exact dispatch shape chat.respond uses", async () => {
    const { LENS_ACTIONS, makeInternalCtx } = await load();
    const handler = LENS_ACTIONS.get("math.naturalQuery");
    assert.ok(handler);
    const ctx = makeInternalCtx("chat-intent-dispatch-test");
    const query = "12 * 8";
    const virtualArtifact = { id: null, domain: "math", type: "domain_action", data: { query }, meta: {} };
    const result = await Promise.resolve(handler(ctx, virtualArtifact, { query }));
    assert.equal(result.ok, true);
    assert.ok(result.result, "expected a populated result payload");
    assert.equal(result.result.answer, 96);
  });

  it("returns an honest failure shape for an uninterpretable query (never fabricates an answer)", async () => {
    const { LENS_ACTIONS, makeInternalCtx } = await load();
    const handler = LENS_ACTIONS.get("math.naturalQuery");
    const ctx = makeInternalCtx("chat-intent-dispatch-test-2");
    const query = "";
    const virtualArtifact = { id: null, domain: "math", type: "domain_action", data: { query }, meta: {} };
    const result = await Promise.resolve(handler(ctx, virtualArtifact, { query }));
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
});
