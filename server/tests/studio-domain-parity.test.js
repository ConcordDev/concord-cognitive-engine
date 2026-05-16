import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  if (!fn) throw new Error(`studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("studio — projects", () => {
  it("creates and lists project", () => {
    call("project-create", ctxA, { name: "Demo", bpm: 128 });
    const r = call("project-list", ctxA);
    assert.equal(r.result.projects.length, 1);
    assert.equal(r.result.projects[0].name, "Demo");
  });

  it("INVARIANT: projects scoped per-user", () => {
    call("project-create", ctxA, { name: "a-only" });
    const b = call("project-list", ctxB);
    assert.equal(b.result.projects.length, 0);
  });

  it("rejects out-of-range bpm", () => {
    const r = call("project-create", ctxA, { name: "x", bpm: 500 });
    assert.equal(r.ok, false);
  });

  it("rejects empty name", () => {
    const r = call("project-create", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("delete removes", () => {
    const c = call("project-create", ctxA, { name: "tmp" });
    call("project-delete", ctxA, { id: c.result.project.id });
    assert.equal(call("project-list", ctxA).result.projects.length, 0);
  });
});

describe("studio — tracks", () => {
  it("adds a track to project", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "midi", name: "Lead" });
    assert.equal(t.ok, true);
    assert.equal(t.result.track.kind, "midi");
    assert.equal(t.result.track.name, "Lead");
    // Sanity defaults
    assert.equal(t.result.track.volume, 0.8);
    assert.equal(t.result.track.muted, false);
  });

  it("track-update changes volume + mute", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const u = call("track-update", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, volume: 0.5, muted: true });
    assert.equal(u.result.track.volume, 0.5);
    assert.equal(u.result.track.muted, true);
  });

  it("rejects volume out of 0..1", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const r = call("track-update", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, volume: 2 });
    assert.equal(r.ok, false);
  });

  it("rejects pan out of -1..1", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const r = call("track-update", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, pan: 5 });
    assert.equal(r.ok, false);
  });
});

describe("studio — effects", () => {
  it("adds effect with defaults", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const e = call("effect-add", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, kind: "delay" });
    assert.equal(e.ok, true);
    assert.equal(e.result.effect.kind, "delay");
    assert.equal(e.result.effect.params.timeMs, 250);
  });

  it("rejects invalid effect kind", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const r = call("effect-add", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, kind: "bogus" });
    assert.equal(r.ok, false);
  });

  it("effect-remove removes", () => {
    const c = call("project-create", ctxA, { name: "P" });
    const t = call("track-add", ctxA, { projectId: c.result.project.id, kind: "audio" });
    const e = call("effect-add", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, kind: "reverb" });
    call("effect-remove", ctxA, { projectId: c.result.project.id, trackId: t.result.track.id, effectId: e.result.effect.id });
    const p = call("project-get", ctxA, { id: c.result.project.id });
    const track = p.result.project.tracks.find((x) => x.id === t.result.track.id);
    assert.equal(track.effects.length, 0);
  });
});
