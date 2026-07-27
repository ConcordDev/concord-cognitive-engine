// server/tests/prompt-registry-persona-portability.test.js
//
// Task #26 of the Private Mode / High Power Mode plan: the conscious
// brain's real VOICE lives only in the repo-root Modelfile's SYSTEM block
// (served by Ollama on a LOCAL dispatch, never sent over the wire), while
// composeSystemPrompt()'s BRAIN_IDENTITY.conscious text is deliberately
// functional-only. A caller that composes a system prompt for an EXTERNAL
// dispatch (a user's BYO override, or High Power Mode's platform-provider
// path) needs the real persona inlined, or that call reads like a generic
// assistant instead of Concord. This pins:
//   1. local dispatch (default) is byte-identical to the pre-fix shape
//      (functional-only, useModelfileSystem: true) — no regression for
//      every existing local-dispatch caller.
//   2. external dispatch inlines the full CONSCIOUS_MODELFILE_PERSONA
//      text (not just the functional layer), and useModelfileSystem
//      flips to false (there's no Modelfile on the other end).
//   3. non-conscious brains are unaffected by dispatchTarget entirely
//      (their persona always comes from BRAIN_IDENTITY, regardless).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { composeSystemPrompt, CONSCIOUS_MODELFILE_PERSONA, BRAIN_IDENTITY } from "../lib/prompt-registry.js";
import { resolveDispatchTarget } from "../lib/byo-router.js";
import { setKey } from "../lib/byo-keys.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";
import { up as upMig397 } from "../migrations/397_brain_mode.js";

describe("composeSystemPrompt — conscious brain, local dispatch (default)", () => {
  it("omits the Modelfile persona text — Ollama serves it from the model itself", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat" });
    assert.equal(r.useModelfileSystem, true);
    assert.ok(!r.system.includes(CONSCIOUS_MODELFILE_PERSONA.slice(0, 40)), "local dispatch must not inline the persona text");
    assert.ok(r.system.includes(BRAIN_IDENTITY.conscious.slice(0, 40)), "local dispatch must still carry the functional directives");
  });

  it("explicit dispatchTarget: 'local' behaves identically to the default", () => {
    const withDefault = composeSystemPrompt("conscious", { mode: "chat" });
    const withExplicit = composeSystemPrompt("conscious", { mode: "chat", dispatchTarget: "local" });
    assert.equal(withDefault.system, withExplicit.system);
    assert.equal(withDefault.useModelfileSystem, withExplicit.useModelfileSystem);
  });
});

describe("composeSystemPrompt — conscious brain, external dispatch (BYO / High Power Mode)", () => {
  it("inlines the full Modelfile persona text ahead of the functional layer", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", dispatchTarget: "external" });
    assert.ok(r.system.includes(CONSCIOUS_MODELFILE_PERSONA), "external dispatch must inline the real persona verbatim");
    assert.ok(r.system.includes(BRAIN_IDENTITY.conscious), "external dispatch must still carry the functional directives too");
    // Persona comes first — an external provider's context window may
    // truncate the tail before the head, so the load-bearing voice text
    // should never be the part most likely to get cut.
    assert.ok(r.system.indexOf(CONSCIOUS_MODELFILE_PERSONA) < r.system.indexOf(BRAIN_IDENTITY.conscious));
  });

  it("useModelfileSystem is false — there's no Modelfile on the other end of an external call", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", dispatchTarget: "external" });
    assert.equal(r.useModelfileSystem, false);
  });

  it("still folds in runtime context (mode/lens/world-voice/style) on top of the persona", () => {
    const r = composeSystemPrompt("conscious", { mode: "agent", currentLens: "code", dispatchTarget: "external" });
    assert.ok(r.system.includes("Mode: agent."));
    assert.ok(r.system.includes(CONSCIOUS_MODELFILE_PERSONA));
  });
});

describe("composeSystemPrompt — non-conscious brains are unaffected by dispatchTarget", () => {
  it("subconscious/utility/repair ignore dispatchTarget entirely", () => {
    for (const brain of ["subconscious", "utility", "repair"]) {
      const local = composeSystemPrompt(brain, { mode: "chat" });
      const external = composeSystemPrompt(brain, { mode: "chat", dispatchTarget: "external" });
      assert.equal(local.system, external.system, `${brain} should be identical regardless of dispatchTarget`);
      assert.equal(local.useModelfileSystem, false);
      assert.equal(external.useModelfileSystem, false);
    }
  });
});

describe("CONSCIOUS_MODELFILE_PERSONA — sanity", () => {
  it("is a non-trivial string containing Concord's actual voice markers", () => {
    assert.equal(typeof CONSCIOUS_MODELFILE_PERSONA, "string");
    assert.ok(CONSCIOUS_MODELFILE_PERSONA.length > 500);
    assert.ok(CONSCIOUS_MODELFILE_PERSONA.includes("You're Concord."));
    assert.ok(CONSCIOUS_MODELFILE_PERSONA.includes("Cut the AI tells"));
  });
});

// byo-router.js#resolveDispatchTarget is the helper the composeSystemPrompt
// call site in server.js uses to predict local-vs-external BEFORE the real
// dispatch decision happens inside brainChat(). Pinned here since it's the
// direct enabler of the persona-portability fix above.
function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, brain_mode TEXT NOT NULL DEFAULT 'private', brain_mode_set_at INTEGER);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT);
  `);
  upMig170(db);
  upMig397(db);
  return db;
}

describe("resolveDispatchTarget", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; process.env.JWT_SECRET = "test-jwt-secret-for-persona-portability-tests"; });

  it("Private-mode user is always 'local', even with an active BYO override", async () => {
    const db = setupDb();
    db.prepare(`INSERT INTO users (id, brain_mode) VALUES ('u1', 'private')`).run();
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-1234567890" });
    assert.equal(resolveDispatchTarget(db, "u1", "conscious"), "local");
  });

  it("High-Power-mode user with an active BYO override for this slot is 'external'", async () => {
    const db = setupDb();
    db.prepare(`INSERT INTO users (id, brain_mode) VALUES ('u2', 'high_power')`).run();
    await setKey(db, "u2", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-1234567890" });
    assert.equal(resolveDispatchTarget(db, "u2", "conscious"), "external");
  });

  it("High-Power-mode user with NO override and no platform provider configured falls back to 'local'", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO users (id, brain_mode) VALUES ('u3', 'high_power')`).run();
    // No CONCORD_PLATFORM_*_API_KEY env vars set in this test environment.
    assert.equal(resolveDispatchTarget(db, "u3", "conscious"), "local");
  });

  it("an unknown user id fails closed to 'local' (getBrainMode's own fail-closed contract)", () => {
    const db = setupDb();
    assert.equal(resolveDispatchTarget(db, "ghost-user", "conscious"), "local");
  });

  it("a missing db fails closed to 'local'", () => {
    assert.equal(resolveDispatchTarget(null, "u1", "conscious"), "local");
  });
});
