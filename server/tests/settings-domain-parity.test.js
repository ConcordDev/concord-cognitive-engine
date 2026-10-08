// Contract tests for server/domains/settings.js — the server-persisted
// application-settings surface (macOS System Settings parity).
// Exercises every macro and asserts the { ok } contract.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSettingsActions from "../domains/settings.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`settings.${name}`);
  if (!fn) throw new Error(`settings.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSettingsActions(register); });

// Each test gets a fresh per-process store so state doesn't leak.
beforeEach(() => { delete globalThis._concordSTATE; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("settings.list / get / applied", () => {
  it("list enumerates the preference schema", () => {
    const r = call("list", ctxA);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.items) && r.result.items.length > 0);
    assert.ok(r.result.sections.includes("audio"));
    assert.ok(r.result.sections.includes("accessibility"));
    assert.ok(r.result.localeLabels["en-US"]);
  });

  it("get returns resolved prefs layered over defaults", () => {
    const r = call("get", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.prefs.quality_preset, "balanced");
    assert.deepEqual(r.result.overriddenKeys, []);
  });

  it("applied returns the active session prefs", () => {
    const r = call("applied", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.userId, "user_a");
  });
});

describe("settings.set / setMany / reset", () => {
  it("set persists a validated value", () => {
    const r = call("set", ctxA, { key: "audio_master_volume", value: 0.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 0.5);
    assert.equal(call("get", ctxA).result.prefs.audio_master_volume, 0.5);
  });

  it("set clamps numbers to range and rejects unknown keys", () => {
    assert.equal(call("set", ctxA, { key: "audio_master_volume", value: 9 }).result.value, 1);
    assert.equal(call("set", ctxA, { key: "nope", value: 1 }).ok, false);
    assert.equal(call("set", ctxA, {}).ok, false);
  });

  it("set rejects invalid enum values", () => {
    assert.equal(call("set", ctxA, { key: "locale", value: "xx-XX" }).ok, false);
    assert.equal(call("set", ctxA, { key: "locale", value: "fr-FR" }).ok, true);
  });

  it("setMany batches writes and reports per-key errors", () => {
    const r = call("setMany", ctxA, {
      updates: { reduced_motion: true, high_contrast: true, bad_key: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.appliedCount, 2);
    assert.ok(r.result.errors.bad_key);
  });

  it("reset restores a single key or all keys to default", () => {
    call("set", ctxA, { key: "quality_preset", value: "ultra" });
    assert.equal(call("reset", ctxA, { key: "quality_preset" }).result.prefs.quality_preset, "balanced");
    call("set", ctxA, { key: "high_contrast", value: true });
    assert.equal(call("reset", ctxA, {}).result.prefs.high_contrast, false);
  });

  it("prefs are per-user isolated", () => {
    call("set", ctxA, { key: "text_size", value: "large" });
    assert.equal(call("get", ctxB).result.prefs.text_size, "default");
  });
});

describe("settings.search", () => {
  it("matches across keys, labels, sections, and keybindings", () => {
    const r = call("search", ctxA, { query: "volume" });
    assert.equal(r.ok, true);
    assert.ok(r.result.matches.length >= 3);
    const kb = call("search", ctxA, { query: "snapshot" });
    assert.ok(kb.result.keybindings.length >= 1);
  });

  it("empty query returns no matches", () => {
    assert.deepEqual(call("search", ctxA, { query: "" }).result.matches, []);
  });
});

describe("settings keybindings", () => {
  it("keybindings lists defaults", () => {
    const r = call("keybindings", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.bindings.some((b) => b.id === "snapshot"));
    assert.equal(r.result.bindings.every((b) => b.customized === false), true);
  });

  it("rebindKey remaps and flags customization + conflicts", () => {
    const r = call("rebindKey", ctxA, { id: "snapshot", keys: "mod+shift+s" });
    assert.equal(r.ok, true);
    assert.equal(r.result.keys, "mod+shift+s");
    assert.equal(call("keybindings", ctxA).result.bindings.find((b) => b.id === "snapshot").customized, true);
    // bind another to the same chord -> conflict reported
    const c = call("rebindKey", ctxA, { id: "search", keys: "mod+shift+s" });
    assert.equal(c.result.conflict, "snapshot");
  });

  it("rebindKey rejects unknown ids and empty chords", () => {
    assert.equal(call("rebindKey", ctxA, { id: "nope", keys: "x" }).ok, false);
    assert.equal(call("rebindKey", ctxA, { id: "snapshot", keys: "" }).ok, false);
  });

  it("resetKeybinding restores one or all", () => {
    call("rebindKey", ctxA, { id: "snapshot", keys: "f9" });
    assert.equal(call("resetKeybinding", ctxA, { id: "snapshot" }).ok, true);
    assert.equal(call("keybindings", ctxA).result.bindings.find((b) => b.id === "snapshot").current, "mod+s");
    assert.equal(call("resetKeybinding", ctxA, {}).ok, true);
  });
});

describe("settings snapshots", () => {
  it("captures, lists, applies, and deletes snapshots", () => {
    call("set", ctxA, { key: "quality_preset", value: "ultra" });
    const cap = call("captureSnapshot", ctxA, { label: "before-tweak" });
    assert.equal(cap.ok, true);
    const id = cap.result.snapshot.id;

    // change the pref away from the snapshot
    call("set", ctxA, { key: "quality_preset", value: "potato" });
    assert.equal(call("get", ctxA).result.prefs.quality_preset, "potato");

    const list = call("listSnapshots", ctxA);
    assert.equal(list.result.snapshots.length, 1);
    assert.equal(list.result.snapshots[0].label, "before-tweak");

    const applied = call("applySnapshot", ctxA, { id });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.prefs.quality_preset, "ultra");

    assert.equal(call("deleteSnapshot", ctxA, { id }).ok, true);
    assert.equal(call("listSnapshots", ctxA).result.snapshots.length, 0);
  });

  it("applySnapshot / deleteSnapshot reject unknown ids", () => {
    assert.equal(call("applySnapshot", ctxA, { id: "missing" }).ok, false);
    assert.equal(call("deleteSnapshot", ctxA, { id: "missing" }).ok, false);
  });
});

describe("settings account & security", () => {
  it("accountOverview reports posture honestly: 2FA is unavailable", () => {
    const r = call("accountOverview", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.twoFactorAvailable, false);
    assert.equal(r.result.twoFactorEnabled, false);
  });

  it("setTwoFactor refuses instead of faking an enrolment or recovery codes", () => {
    for (const enabled of [true, false]) {
      const r = call("setTwoFactor", ctxA, { enabled });
      assert.equal(r.ok, false);
      assert.match(r.error, /not available/);
      assert.equal(r.result, undefined);
    }
    assert.equal(call("accountOverview", ctxA).result.twoFactorEnabled, false);
  });

  it("changePassword enforces policy", () => {
    assert.equal(call("changePassword", ctxA, { currentPassword: "", newPassword: "abc123456789" }).ok, false);
    assert.equal(call("changePassword", ctxA, { currentPassword: "old", newPassword: "short" }).ok, false);
    // 9 chars — has letters+numbers but is below the 12-char floor that
    // mirrors server.js's real `/api/auth/change-password` policy.
    assert.equal(call("changePassword", ctxA, { currentPassword: "old", newPassword: "newpass99" }).ok, false);
    assert.equal(call("changePassword", ctxA, { currentPassword: "old", newPassword: "alllettersonlyx" }).ok, false);
    const ok = call("changePassword", ctxA, { currentPassword: "oldpass1", newPassword: "newpass123456" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.accepted, true);
  });

  it("sessions lists only the request's own session and says other devices are untracked", () => {
    const list = call("sessions", ctxA);
    assert.equal(list.result.sessions.length, 1);
    assert.equal(list.result.sessions[0].current, true);
    assert.equal(list.result.otherDevicesTracked, false);
    assert.match(list.result.signOutEverywhere, /revoke-all-sessions/);
  });

  it("per-session revoke is an honest failure that points at the real endpoint", () => {
    const id = call("sessions", ctxA).result.sessions[0].id;
    for (const r of [call("revokeSession", ctxA, { id }), call("revokeOtherSessions", ctxA)]) {
      assert.equal(r.ok, false);
      assert.match(r.error, /revoke-all-sessions/);
    }
  });

  it("linked-account macros defer to the real auth routes instead of keeping a fake list", () => {
    for (const r of [
      call("connectAccount", ctxA, { provider: "github", handle: "octocat" }),
      call("disconnectAccount", ctxA, { id: "x" }),
      call("connectedAccounts", ctxA),
    ]) {
      assert.equal(r.ok, false);
      assert.match(r.error, /\/api\/auth\//);
    }
  });
});
