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

// ── Full-app parity (Logic + Ableton 12 + Pro Tools 2026) ──────

function newProjAndTrack(ctx) {
  const proj = call("project-create", ctx, { name: "P", bpm: 120 });
  const trk = call("track-add", ctx, { projectId: proj.result.project.id, kind: "midi" });
  return { projectId: proj.result.project.id, trackId: trk.result.track.id };
}

describe("studio.clips-* (regions)", () => {
  it("create / update / delete cycle, scoped per project/track", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const c = call("clips-create", ctxA, { projectId, trackId, name: "verse", startBeats: 0, lengthBeats: 8 });
    assert.equal(c.ok, true);
    assert.equal(c.result.clip.kind, "midi");
    const u = call("clips-update", ctxA, { id: c.result.clip.id, startBeats: 4, name: "verse 2" });
    assert.equal(u.result.clip.startBeats, 4);
    assert.equal(u.result.clip.name, "verse 2");
    assert.equal(call("clips-list", ctxA, { projectId, trackId }).result.clips.length, 1);
    assert.equal(call("clips-delete", ctxA, { id: c.result.clip.id }).ok, true);
    assert.equal(call("clips-list", ctxA, { projectId, trackId }).result.clips.length, 0);
  });
  it("delete cascades MIDI notes", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const c = call("clips-create", ctxA, { projectId, trackId });
    call("midi-notes-add", ctxA, { clipId: c.result.clip.id, pitch: 60, velocity: 100, startBeats: 0, lengthBeats: 1 });
    assert.equal(call("midi-notes-list", ctxA, { clipId: c.result.clip.id }).result.notes.length, 1);
    call("clips-delete", ctxA, { id: c.result.clip.id });
    assert.equal(call("midi-notes-list", ctxA, { clipId: c.result.clip.id }).result.notes.length, 0);
  });
  it("rejects bad input", () => {
    assert.equal(call("clips-create", ctxA, { projectId: "", trackId: "x" }).ok, false);
    assert.equal(call("clips-create", ctxA, { projectId: "x", trackId: "nope" }).ok, false);
  });
});

describe("studio.midi-notes-* (piano roll)", () => {
  it("add / list / delete cycle scoped by clipId", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId });
    const n1 = call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 60, velocity: 100, startBeats: 0, lengthBeats: 0.5 });
    assert.equal(n1.ok, true);
    call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 64, velocity: 90, startBeats: 0.5, lengthBeats: 0.5 });
    assert.equal(call("midi-notes-list", ctxA, { clipId: clip.result.clip.id }).result.notes.length, 2);
    assert.equal(call("midi-notes-delete", ctxA, { id: n1.result.note.id }).ok, true);
  });
  it("clamps pitch + velocity ranges", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId });
    const r = call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 200, velocity: 999 });
    assert.equal(r.result.note.pitch, 127);
    assert.equal(r.result.note.velocity, 127);
  });
});

describe("studio.automation-* (parameter envelopes)", () => {
  it("add lane + sorted points", () => {
    const { trackId } = newProjAndTrack(ctxA);
    const lane = call("automation-add-lane", ctxA, { trackId, parameter: "volume" });
    assert.equal(lane.ok, true);
    call("automation-add-point", ctxA, { laneId: lane.result.lane.id, timeBeats: 4, value: 0.5 });
    call("automation-add-point", ctxA, { laneId: lane.result.lane.id, timeBeats: 0, value: 0 });
    call("automation-add-point", ctxA, { laneId: lane.result.lane.id, timeBeats: 8, value: 1 });
    const list = call("automation-list", ctxA, { trackId });
    assert.equal(list.result.lanes[0].points.length, 3);
    assert.equal(list.result.lanes[0].points[0].timeBeats, 0);
    assert.equal(list.result.lanes[0].points[2].timeBeats, 8);
  });
  it("rejects bad input", () => {
    assert.equal(call("automation-add-lane", ctxA, { trackId: "", parameter: "vol" }).ok, false);
    assert.equal(call("automation-add-point", ctxA, { laneId: "nope", timeBeats: 0, value: 1 }).ok, false);
  });
});

describe("studio.bounce + renders-list", () => {
  it("bounce creates completed render entry", () => {
    const proj = call("project-create", ctxA, { name: "Mix", bpm: 120 });
    const r = call("bounce", ctxA, { projectId: proj.result.project.id, format: "wav_32f", sampleRate: 96000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.render.status, "completed");
    assert.equal(r.result.render.format, "wav_32f");
    assert.equal(r.result.render.sampleRate, 96000);
    assert.equal(call("renders-list", ctxA, {}).result.renders.length, 1);
  });
  it("stems flag changes render kind", () => {
    const proj = call("project-create", ctxA, { name: "Mix", bpm: 120 });
    const r = call("bounce", ctxA, { projectId: proj.result.project.id, stems: true });
    assert.equal(r.result.render.kind, "stems");
  });
  it("rejects unknown project", () => {
    assert.equal(call("bounce", ctxA, { projectId: "nope" }).ok, false);
  });
});

describe("studio.markers-* + tempo-changes", () => {
  it("markers added are sorted by time", () => {
    const proj = call("project-create", ctxA, { name: "P", bpm: 120 });
    call("markers-add", ctxA, { projectId: proj.result.project.id, name: "Chorus", timeBeats: 32 });
    call("markers-add", ctxA, { projectId: proj.result.project.id, name: "Intro", timeBeats: 0 });
    call("markers-add", ctxA, { projectId: proj.result.project.id, name: "Verse", timeBeats: 16 });
    const list = call("markers-list", ctxA, { projectId: proj.result.project.id });
    assert.equal(list.result.markers[0].name, "Intro");
    assert.equal(list.result.markers[2].name, "Chorus");
  });
  it("tempo changes sort and clamp bpm", () => {
    const proj = call("project-create", ctxA, { name: "P", bpm: 120 });
    call("tempo-add", ctxA, { projectId: proj.result.project.id, bpm: 9999, atBeats: 0 });
    const list = call("tempo-changes", ctxA, { projectId: proj.result.project.id });
    assert.equal(list.result.changes[0].bpm, 999);
  });
});

describe("studio.presets-* (preset library)", () => {
  it("save / list / delete cycle, filterable by pluginName", () => {
    const p1 = call("presets-save", ctxA, { name: "Big Hall", pluginName: "ReverbX", category: "spaces" });
    call("presets-save", ctxA, { name: "Punchy", pluginName: "CompPro", category: "drums" });
    assert.equal(call("presets-list", ctxA, {}).result.presets.length, 2);
    assert.equal(call("presets-list", ctxA, { pluginName: "ReverbX" }).result.presets.length, 1);
    assert.equal(call("presets-delete", ctxA, { id: p1.result.preset.id }).ok, true);
  });
});

describe("studio.sends-* (mixer routing)", () => {
  it("set creates or updates by from/to pair", () => {
    const proj = call("project-create", ctxA, { name: "P", bpm: 120 });
    call("sends-set", ctxA, { projectId: proj.result.project.id, fromTrackId: "t1", toTrackId: "bus_reverb", levelDb: -6 });
    call("sends-set", ctxA, { projectId: proj.result.project.id, fromTrackId: "t1", toTrackId: "bus_reverb", levelDb: -3 });
    const list = call("sends-list", ctxA, { projectId: proj.result.project.id });
    assert.equal(list.result.sends.length, 1);
    assert.equal(list.result.sends[0].levelDb, -3);
  });
});

describe("studio.scenes-* (Ableton clip launcher)", () => {
  it("create scene, launch toggles clip muted flags", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const scn = call("scenes-create", ctxA, { projectId, name: "A" });
    assert.equal(scn.ok, true);
    assert.equal(scn.result.scene.order, 0);
    const clipA = call("clips-create", ctxA, { projectId, trackId, sceneId: scn.result.scene.id });
    const clipB = call("clips-create", ctxA, { projectId, trackId, sceneId: "other" });
    const launched = call("scenes-launch", ctxA, { id: scn.result.scene.id });
    assert.equal(launched.result.clipsLaunched, 1);
    const updatedA = call("clips-list", ctxA, { projectId, trackId }).result.clips.find(c => c.id === clipA.result.clip.id);
    const updatedB = call("clips-list", ctxA, { projectId, trackId }).result.clips.find(c => c.id === clipB.result.clip.id);
    assert.equal(updatedA.muted, false);
    assert.equal(updatedB.muted, true);
  });
});

describe("studio.dashboard-summary", () => {
  it("aggregates projects + clips + renders + presets", () => {
    const ctxC = { actor: { userId: "user_dash_stu" }, userId: "user_dash_stu" };
    const proj = call("project-create", ctxC, { name: "P1", bpm: 120 });
    const trk = call("track-add", ctxC, { projectId: proj.result.project.id, kind: "audio" });
    call("clips-create", ctxC, { projectId: proj.result.project.id, trackId: trk.result.track.id, kind: "audio" });
    call("clips-create", ctxC, { projectId: proj.result.project.id, trackId: trk.result.track.id, kind: "midi" });
    call("bounce", ctxC, { projectId: proj.result.project.id });
    call("presets-save", ctxC, { name: "X", pluginName: "Y" });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.result.projectCount, 1);
    assert.equal(d.result.totalTracks, 1);
    assert.equal(d.result.totalClips, 2);
    assert.equal(d.result.audioClips, 1);
    assert.equal(d.result.midiClips, 1);
    assert.equal(d.result.rendersCompleted, 1);
    assert.equal(d.result.presetsCount, 1);
  });
});
