// tests/presence-idle-activity-wiring.test.js
//
// Pins the 2026-09-10 fix: authMiddleware's three real auth paths (cookie,
// Bearer JWT, API key) must call _markActivity({ authed: true }).
//
// The bug: Sprint 60+ added the presence-idle gate — governorTick's heavy
// maintenance (autogen/dream/evolution/synth, NPC ticks, city broadcasts,
// feed polling, consolidation) early-returns `{skipped:"idle_no_users"}`
// and does NOT bump concord_heartbeat_ticks_total when
// shouldRunHeavyMaintenance() is false. That signal is fed ONLY by
// _markActivity({authed:true}), which was wired into the AUTH_MODE==="public"
// branch of authMiddleware but NOT the normal cookie / Bearer-JWT / API-key
// paths. Result: an authenticated load never woke the governor —
// "governor did not tick during the load window (frozen loop)" in the
// tick-SLO gate, and a latent prod stall whenever AUTH_MODE !== "public".
//
// This test has two layers:
//   1. presence-idle's own contract — markActivity({authed:true}) clears idle.
//   2. a source-shape assertion that every `req.user = user` in authMiddleware
//      that resolved from a real credential is followed by a _markActivity call
//      before its `return _sovereignGate()`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("presence-idle — markActivity contract", () => {
  it("markActivity({authed:true}) makes shouldRunHeavyMaintenance() true", async () => {
    process.env.CONCORD_IDLE_AUTH_MS = "60000";
    const mod = await import("../lib/presence-idle.js?wiringtest=" + Date.now());
    // Fresh module: no activity yet → idle → no heavy maintenance.
    assert.equal(mod.isIdle(), true);
    assert.equal(mod.shouldRunHeavyMaintenance(), false);

    mod.markActivity({ authed: true });
    assert.equal(mod.isIdle(), false, "an authed request must clear idle");
    assert.equal(mod.shouldRunHeavyMaintenance(), true, "heavy maintenance must run right after an authed request");

    // An anonymous probe must NOT extend the window.
    mod.markActivity({ authed: false });
    assert.equal(mod.shouldRunHeavyMaintenance(), true); // still awake from the authed hit
  });
});

describe("authMiddleware — every real auth path wakes presence-idle", () => {
  const src = readFileSync(path.join(ROOT, "server.js"), "utf8");

  // The authMiddleware body: from `function authMiddleware(` to the matching
  // close. A generous slice is fine — we only assert on the 4 credentialed
  // `req.authMethod = ...` sites inside it.
  const start = src.indexOf("function authMiddleware(");
  assert.ok(start >= 0, "authMiddleware present");
  const body = src.slice(start, start + 45000);

  for (const method of ['"cookie"', '"jwt"', '"apiKey"']) {
    it(`the ${method} auth path calls _markActivity before returning`, () => {
      const at = body.indexOf(`req.authMethod = ${method};`);
      assert.ok(at >= 0, `req.authMethod = ${method} present in authMiddleware`);
      // Look at the ~500 chars after the authMethod assignment, up to the
      // next `return` — _markActivity must appear in that window.
      const after = body.slice(at, at + 500);
      const ret = after.indexOf("return ");
      const window = ret >= 0 ? after.slice(0, ret) : after;
      assert.match(
        window,
        /_markActivity\(\{\s*authed:\s*true\s*\}\)/,
        `the ${method} path resolves a real credential — it must _markActivity({authed:true}) so the governor's idle gate wakes`,
      );
    });
  }

  it("the AUTH_MODE=public best-effort-identify branch also calls it (unchanged)", () => {
    // this one predates the fix; assert it stayed.
    const publicBranch = body.slice(0, body.indexOf('const alwaysPublic'));
    assert.match(publicBranch, /_markActivity\(\{\s*authed:\s*true\s*\}\)/);
  });
});
