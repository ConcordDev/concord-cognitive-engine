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
  it("records an honest pending render when no client audio is supplied (not produced)", async () => {
    const proj = call("project-create", ctxA, { name: "Mix", bpm: 120 });
    const r = await call("bounce", ctxA, { projectId: proj.result.project.id, format: "wav_32f", sampleRate: 96000 });
    assert.equal(r.ok, false, "no audio encoded → must not claim success");
    assert.equal(r.result.render.status, "pending");
    assert.equal(r.result.render.reason, "needs_client_render");
    assert.equal(r.result.render.downloadUrl, undefined);
    assert.equal(r.result.render.format, "wav_32f");
    assert.equal(r.result.render.sampleRate, 96000);
    assert.equal(call("renders-list", ctxA, {}).result.renders.length, 1);
  });
  it("stems flag changes render kind", async () => {
    const proj = call("project-create", ctxA, { name: "Mix", bpm: 120 });
    const r = await call("bounce", ctxA, { projectId: proj.result.project.id, stems: true });
    assert.equal(r.result.render.kind, "stems");
  });
  it("rejects unknown project", async () => {
    assert.equal((await call("bounce", ctxA, { projectId: "nope" })).ok, false);
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

// ── Feature-parity backlog vs Ableton Live (2026) ──────────────

describe("studio.clip-* (audio clip editing — warp / slice / fades)", () => {
  it("clip-warp-set stores sorted warp markers and enables warping", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId, kind: "audio", lengthBeats: 8 });
    const r = call("clip-warp-set", ctxA, {
      clipId: clip.result.clip.id,
      warpMarkers: [{ beat: 4, sampleSec: 2 }, { beat: 0, sampleSec: 0 }],
      warpMode: "complex",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.clip.warpMarkers[0].beat, 0);
    assert.equal(r.result.clip.warpEnabled, true);
    assert.equal(r.result.clip.warpMode, "complex");
  });
  it("clip-slice splits a clip in two", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId, startBeats: 0, lengthBeats: 8 });
    const r = call("clip-slice", ctxA, { clipId: clip.result.clip.id, atBeats: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.left.lengthBeats, 3);
    assert.equal(r.result.right.startBeats, 3);
    assert.equal(r.result.right.lengthBeats, 5);
  });
  it("clip-slice rejects an out-of-bounds split point", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId, startBeats: 0, lengthBeats: 4 });
    assert.equal(call("clip-slice", ctxA, { clipId: clip.result.clip.id, atBeats: 99 }).ok, false);
  });
  it("clip-fade-set clamps fades and gain", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId, lengthBeats: 4 });
    const r = call("clip-fade-set", ctxA, { clipId: clip.result.clip.id, fadeInBeats: 99, gainDb: 999, fadeInCurve: "exp" });
    assert.equal(r.result.clip.fadeInBeats, 4);
    assert.equal(r.result.clip.gainDb, 12);
    assert.equal(r.result.clip.fadeInCurve, "exp");
  });
});

describe("studio.drumrack-* (sampler / drum rack)", () => {
  it("create / list / pad-assign / delete cycle", () => {
    const proj = call("project-create", ctxA, { name: "P" });
    const c = call("drumrack-create", ctxA, { projectId: proj.result.project.id, name: "Kit", padCount: 16 });
    assert.equal(c.ok, true);
    assert.equal(c.result.rack.pads.length, 16);
    const a = call("drumrack-pad-assign", ctxA, { rackId: c.result.rack.id, padIndex: 0, label: "Kick", gainDb: -3, tuneSemitones: 2 });
    assert.equal(a.result.rack.pads[0].label, "Kick");
    assert.equal(a.result.rack.pads[0].gainDb, -3);
    assert.equal(call("drumrack-list", ctxA, { projectId: proj.result.project.id }).result.racks.length, 1);
    assert.equal(call("drumrack-delete", ctxA, { id: c.result.rack.id }).ok, true);
    assert.equal(call("drumrack-list", ctxA, { projectId: proj.result.project.id }).result.racks.length, 0);
  });
  it("rejects bad pad index", () => {
    const proj = call("project-create", ctxA, { name: "P" });
    const c = call("drumrack-create", ctxA, { projectId: proj.result.project.id, name: "Kit", padCount: 8 });
    assert.equal(call("drumrack-pad-assign", ctxA, { rackId: c.result.rack.id, padIndex: 99 }).ok, false);
  });
});

describe("studio.fx-rack-* (EQ / compressor / reverb / delay)", () => {
  it("save / list / delete with param schema", () => {
    const r = call("fx-rack-save", ctxA, { name: "Vocal Chain", units: [{ type: "eq" }, { type: "compressor" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.rack.units.length, 2);
    const list = call("fx-rack-list", ctxA, {});
    assert.equal(list.result.racks.length, 1);
    assert.ok(list.result.schema.compressor);
    assert.equal(call("fx-rack-delete", ctxA, { id: r.result.rack.id }).ok, true);
  });
  it("rejects invalid unit type", () => {
    assert.equal(call("fx-rack-save", ctxA, { name: "X", units: [{ type: "bogus" }] }).ok, false);
    assert.equal(call("fx-rack-save", ctxA, { name: "X", units: [] }).ok, false);
  });
});

describe("studio.midi-map-* (Web MIDI controller mapping)", () => {
  it("add / list / delete cycle scoped per project", () => {
    const proj = call("project-create", ctxA, { name: "P" });
    const m = call("midi-map-add", ctxA, { projectId: proj.result.project.id, target: "track1.volume", msgType: "cc", controller: 7, channel: 0 });
    assert.equal(m.ok, true);
    assert.equal(m.result.map.controller, 7);
    assert.equal(call("midi-map-list", ctxA, { projectId: proj.result.project.id }).result.maps.length, 1);
    assert.equal(call("midi-map-delete", ctxA, { id: m.result.map.id }).ok, true);
  });
  it("rejects missing target", () => {
    const proj = call("project-create", ctxA, { name: "P" });
    assert.equal(call("midi-map-add", ctxA, { projectId: proj.result.project.id, target: "" }).ok, false);
  });
});

describe("studio.midi-quantize + groove", () => {
  it("midi-quantize snaps notes to the grid", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId });
    call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 60, startBeats: 0.27, lengthBeats: 0.5 });
    call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 62, startBeats: 1.18, lengthBeats: 0.5 });
    const r = call("midi-quantize", ctxA, { clipId: clip.result.clip.id, gridBeats: 0.25, strength: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.quantized, 2);
    const notes = call("midi-notes-list", ctxA, { clipId: clip.result.clip.id }).result.notes;
    assert.ok(notes.every((n) => Math.abs((n.startBeats / 0.25) - Math.round(n.startBeats / 0.25)) < 1e-6));
  });
  it("groove-list returns built-in groove templates", () => {
    const r = call("groove-list", ctxA, {});
    assert.ok(r.result.grooves.length >= 4);
    assert.ok(r.result.grooves.some((g) => g.id === "straight"));
  });
  it("groove-apply applies swing to a clip's notes", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId });
    call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 60, startBeats: 0, lengthBeats: 0.5 });
    const r = call("groove-apply", ctxA, { clipId: clip.result.clip.id, gridBeats: 0.5, swing: 0.33, velAccent: 0.1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.grooved, 1);
  });
  it("midi-quantize rejects empty clip", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId });
    assert.equal(call("midi-quantize", ctxA, { clipId: clip.result.clip.id, gridBeats: 0.25 }).ok, false);
  });
});

describe("studio.record-config-* + takes-* (metronome / count-in / comping)", () => {
  it("record-config get returns defaults then set persists", () => {
    const proj = call("project-create", ctxA, { name: "P" });
    const g = call("record-config-get", ctxA, { projectId: proj.result.project.id });
    assert.equal(g.result.config.metronomeEnabled, true);
    const s = call("record-config-set", ctxA, { projectId: proj.result.project.id, countInBars: 2, loopRecord: true });
    assert.equal(s.result.config.countInBars, 2);
    assert.equal(s.result.config.loopRecord, true);
  });
  it("takes add / comp-select / delete cycle", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const t1 = call("takes-add", ctxA, { projectId, trackId, name: "Take A" });
    const t2 = call("takes-add", ctxA, { projectId, trackId, name: "Take B" });
    assert.equal(t1.result.take.selected, true);
    assert.equal(t2.result.take.selected, false);
    call("takes-comp-select", ctxA, { id: t2.result.take.id });
    const list = call("takes-list", ctxA, { trackId }).result.takes;
    assert.equal(list.find((t) => t.id === t2.result.take.id).selected, true);
    assert.equal(list.find((t) => t.id === t1.result.take.id).selected, false);
    assert.equal(call("takes-delete", ctxA, { id: t2.result.take.id }).ok, true);
  });
});

describe("studio.export-stems + project-import/export", () => {
  it("records one honest pending stem per track when no client audio is supplied", async () => {
    const { projectId } = newProjAndTrack(ctxA);
    call("track-add", ctxA, { projectId, kind: "audio" });
    const r = await call("export-stems", ctxA, { projectId, format: "wav_24" });
    assert.equal(r.ok, false, "no stems encoded → must not claim success");
    assert.equal(r.result.job.status, "pending");
    assert.equal(r.result.job.stemCount, 2);
    assert.equal(r.result.job.stems.length, 2);
    assert.ok(r.result.job.stems.every((s) => s.status === "pending" && s.downloadUrl === undefined));
  });
  it("export-stems rejects a project with no tracks", async () => {
    const proj = call("project-create", ctxA, { name: "Empty" });
    assert.equal((await call("export-stems", ctxA, { projectId: proj.result.project.id })).ok, false);
  });
  it("project-export then project-import round-trips", () => {
    const { projectId, trackId } = newProjAndTrack(ctxA);
    const clip = call("clips-create", ctxA, { projectId, trackId, name: "verse" });
    call("midi-notes-add", ctxA, { clipId: clip.result.clip.id, pitch: 60, startBeats: 0, lengthBeats: 1 });
    call("markers-add", ctxA, { projectId, name: "Intro", timeBeats: 0 });
    const exp = call("project-export", ctxA, { projectId });
    assert.equal(exp.ok, true);
    assert.equal(exp.result.bundle.format, "concord-studio-project/v1");
    const imp = call("project-import", ctxA, { bundle: exp.result.bundle });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.imported.tracks, 1);
    assert.equal(imp.result.imported.clips, 1);
    assert.equal(imp.result.imported.notes, 1);
    assert.equal(imp.result.imported.markers, 1);
  });
  it("project-import rejects a malformed bundle", () => {
    assert.equal(call("project-import", ctxA, { bundle: { format: "wrong" } }).ok, false);
    assert.equal(call("project-import", ctxA, {}).ok, false);
  });
});

describe("studio.collab-* (real-time collaboration)", () => {
  it("start session, second user joins, edit log appends", () => {
    const proj = call("project-create", ctxA, { name: "Jam" });
    const start = call("collab-session-start", ctxA, { projectId: proj.result.project.id, displayName: "Host" });
    assert.equal(start.ok, true);
    assert.equal(start.result.session.collaborators.length, 1);
    const join = call("collab-join", ctxB, { projectId: proj.result.project.id, displayName: "Guest" });
    assert.equal(join.ok, true);
    assert.equal(join.result.session.collaborators.length, 2);
    const edit = call("collab-edit", ctxB, { projectId: proj.result.project.id, op: "clip-create", target: "clip1" });
    assert.equal(edit.ok, true);
    assert.equal(edit.result.entry.seq, 1);
    const since = call("collab-since", ctxA, { projectId: proj.result.project.id, sinceSeq: 0 });
    assert.equal(since.result.entries.length, 1);
    assert.equal(since.result.entries[0].op, "clip-create");
  });
  it("presence updates collaborator cursor", () => {
    const proj = call("project-create", ctxA, { name: "Jam2" });
    call("collab-session-start", ctxA, { projectId: proj.result.project.id });
    const p = call("collab-presence", ctxA, { projectId: proj.result.project.id, cursorBeats: 12 });
    assert.equal(p.ok, true);
    assert.equal(p.result.collaborators[0].cursorBeats, 12);
  });
  it("collab-leave removes a collaborator; last leaver closes the session", () => {
    const proj = call("project-create", ctxA, { name: "Jam3" });
    call("collab-session-start", ctxA, { projectId: proj.result.project.id });
    call("collab-join", ctxB, { projectId: proj.result.project.id });
    assert.equal(call("collab-leave", ctxB, { projectId: proj.result.project.id }).result.sessionClosed, false);
    assert.equal(call("collab-leave", ctxA, { projectId: proj.result.project.id }).result.sessionClosed, true);
    assert.equal(call("collab-session-get", ctxA, { projectId: proj.result.project.id }).result.session, null);
  });
  it("collab-join rejects when no session exists", () => {
    const proj = call("project-create", ctxA, { name: "Jam4" });
    assert.equal(call("collab-join", ctxB, { projectId: proj.result.project.id }).ok, false);
  });
});

describe("studio.dashboard-summary", () => {
  it("aggregates projects + clips + renders + presets", async () => {
    const ctxC = { actor: { userId: "user_dash_stu" }, userId: "user_dash_stu" };
    const proj = call("project-create", ctxC, { name: "P1", bpm: 120 });
    const trk = call("track-add", ctxC, { projectId: proj.result.project.id, kind: "audio" });
    call("clips-create", ctxC, { projectId: proj.result.project.id, trackId: trk.result.track.id, kind: "audio" });
    call("clips-create", ctxC, { projectId: proj.result.project.id, trackId: trk.result.track.id, kind: "midi" });
    await call("bounce", ctxC, { projectId: proj.result.project.id }); // honest pending (no client audio) → NOT counted completed
    call("presets-save", ctxC, { name: "X", pluginName: "Y" });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.result.projectCount, 1);
    assert.equal(d.result.totalTracks, 1);
    assert.equal(d.result.totalClips, 2);
    assert.equal(d.result.audioClips, 1);
    assert.equal(d.result.midiClips, 1);
    assert.equal(d.result.rendersCompleted, 0); // a pending render is not "completed" — honest
    assert.equal(d.result.presetsCount, 1);
  });
});
