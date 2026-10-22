// server/tests/studio-projects-versions.test.js
//
// Studio save is the artist's safety net: rev counter, automatic and manual
// version snapshots, restore without data loss, conflict preservation,
// round-trip of the DAW snapshot, and the music-only library filter.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerStudioActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  if (!fn) throw new Error(`studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerStudioActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "u_artist" }, userId: "u_artist" };
const ctxB = { actor: { userId: "u_other" }, userId: "u_other" };

const daw = (title, notes = 3) => ({
  id: "x", title, bpm: 92, tracks: [{ id: "t1", name: "Keys", type: "midi", volume: -3, pan: 0.2, effectChain: [{ id: "fx1", type: "reverb", wet: 0.2, params: { decay: 1.8 } }],
    clips: [{ id: "c1", type: "midi", startBeat: 0, lengthBeats: 4, midiNotes: Array.from({ length: notes }, (_, i) => ({ id: `n${i}`, pitch: 60 + i, startBeat: i, lengthBeats: 1, velocity: 100 })) }] }],
  audioAssets: { a1: { id: "a1", name: "Take 1", sampleRate: 48000, duration: 3.2, channels: 1, waveformPeaks: [0.1, 0.5], uploaded: true } },
  audioBuffers: { a1: { junk: true } },
});

describe("studio project save / versions", () => {
  it("round-trips the DAW snapshot exactly (minus transient audioBuffers)", () => {
    const created = call("project-create", ctxA, { name: "Song", daw: daw("Song") });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.equal(created.result.project.rev, 1);
    const saved = call("project-save", ctxA, { id, daw: daw("Song", 5), baseRev: 1 });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.project.rev, 2);
    assert.equal(saved.result.project.daw, undefined, "save response stays small");
    const got = call("project-get", ctxA, { id });
    const expected = { ...daw("Song", 5), audioBuffers: {} };
    assert.deepEqual(got.result.project.daw, expected);
    assert.equal(got.result.project.versions, undefined, "version blobs are never shipped");
  });

  it("keeps projects per user", () => {
    const id = call("project-create", ctxA, { name: "Mine", daw: daw("Mine") }).result.project.id;
    assert.equal(call("project-get", ctxB, { id }).ok, false);
    assert.equal(call("project-list", ctxB).result.projects.length, 0);
    const list = call("project-list", ctxA).result.projects;
    assert.equal(list.length, 1);
    assert.equal(list[0].trackCount, 1);
    assert.equal(list[0].versions, undefined);
  });

  it("snapshots, lists and restores versions without losing the current state", () => {
    const id = call("project-create", ctxA, { name: "V", daw: daw("V", 1) }).result.project.id;
    const snap = call("project-snapshot", ctxA, { id, label: "Before chorus" });
    assert.equal(snap.ok, true);
    call("project-save", ctxA, { id, daw: daw("V", 8), baseRev: 1 });
    const versions = call("project-versions", ctxA, { id }).result.versions;
    assert.ok(versions.some((v) => v.label === "Before chorus"));
    const restored = call("project-version-restore", ctxA, { id, versionId: snap.result.version.id });
    assert.equal(restored.ok, true);
    assert.equal(restored.result.project.daw.tracks[0].clips[0].midiNotes.length, 1);
    const after = call("project-versions", ctxA, { id }).result.versions;
    assert.ok(after.some((v) => /^Before restoring/.test(v.label)), "pre-restore state kept as a version");
  });

  it("preserves the other device's work when a stale client saves (rev conflict)", () => {
    const id = call("project-create", ctxA, { name: "C", daw: daw("C", 2) }).result.project.id;
    call("project-save", ctxA, { id, daw: daw("C", 6), baseRev: 1 }); // device 1 → rev 2
    const stale = call("project-save", ctxA, { id, daw: daw("C", 3), baseRev: 1 }); // device 2 still on rev 1
    assert.equal(stale.result.conflict, true);
    const versions = call("project-versions", ctxA, { id }).result.versions;
    assert.ok(versions.some((v) => /another device/.test(v.label)));
  });

  it("caps versions at 20", () => {
    const id = call("project-create", ctxA, { name: "Cap", daw: daw("Cap") }).result.project.id;
    for (let i = 0; i < 30; i++) call("project-snapshot", ctxA, { id, label: `s${i}` });
    assert.equal(call("project-versions", ctxA, { id }).result.versions.length, 20);
  });
});

describe("studio.library-browse (music-only import filter)", () => {
  it("returns only the caller's music items", () => {
    const S = globalThis._concordSTATE;
    const put = (d) => S.dtus.set(d.id, d);
    put({ id: "d1", title: "Kick sample.wav", author: "u_artist", tags: ["sample"] });
    put({ id: "d2", title: "Chord loop", author: "u_artist", machine: { kind: "music_dtu" }, tags: ["loop"] });
    put({ id: "d3", title: "Groove.mid", author: "u_artist" });
    put({ id: "d4", title: "Quarterly report", author: "u_artist", machine: { kind: "document" } });
    put({ id: "d5", title: "server.js refactor", author: "u_artist", tags: ["code"] });
    put({ id: "d6", title: "Someone else's beat.wav", author: "u_other" });
    put({ id: "d7", title: "Hidden.wav", author: "u_artist", tier: "shadow" });
    put({ id: "d8", title: "My synth preset", author: "u_artist", machine: { kind: "synth_preset" } });
    const r = call("library-browse", ctxA, {});
    const ids = r.result.items.map((i) => i.id).sort();
    assert.deepEqual(ids, ["d1", "d2", "d3", "d8"]);
    const kinds = Object.fromEntries(r.result.items.map((i) => [i.id, i.kind]));
    assert.equal(kinds.d1, "sample");
    assert.equal(kinds.d3, "midi");
    assert.equal(kinds.d8, "preset");
    assert.deepEqual(call("library-browse", ctxA, { kind: "midi" }).result.items.map((i) => i.id), ["d3"]);
  });
});
