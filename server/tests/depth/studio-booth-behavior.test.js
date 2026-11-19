// tests/depth/studio-booth-behavior.test.js — the Booth's backend: song
// sections (studio.markers-*), MIDI learn (studio.midi-map-*) and saved
// chains (studio.fx-rack-*), all keyed to the real DAW project the Booth
// has open. Behavioural (exact values) and adversarial (garbage numbers,
// other users' data, double actions, injection-shaped text, refused calls
// write nothing).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

async function newProject(ctx, name) {
  const r = await lensRun("studio", "project-create", { params: { name, bpm: 92 } }, ctx);
  assert.equal(r.ok, true);
  return r.result.project.id;
}
const list = async (ctx, projectId) =>
  (await lensRun("studio", "markers-list", { params: { projectId } }, ctx)).result.markers;

describe("studio booth — song sections", () => {
  let ctx, other, projectId;
  before(async () => {
    ctx = await depthCtx("booth-sections");
    other = await depthCtx("booth-sections-stranger");
    projectId = await newProject(ctx, "Booth sections");
  });

  it("adds sections in any order and lists them by time with exact fields", async () => {
    const chorus = await lensRun("studio", "markers-add", { params: { projectId, name: "Chorus", timeBeats: 32, colour: "#ff3b30", lengthBeats: 16 } }, ctx);
    assert.equal(chorus.ok, true);
    assert.equal(chorus.result.marker.colour, "#ff3b30");
    assert.equal(chorus.result.marker.lengthBeats, 16);
    assert.equal(chorus.result.marker.kind, "section");
    await lensRun("studio", "markers-add", { params: { projectId, name: "Verse 1", timeBeats: 8.5 } }, ctx);
    await lensRun("studio", "markers-add", { params: { projectId, name: "Intro" } }, ctx);
    const got = await list(ctx, projectId);
    assert.deepEqual(got.map((m) => [m.name, m.timeBeats]), [["Intro", 0], ["Verse 1", 8.5], ["Chorus", 32]]);
  });

  it("strips control characters, caps names at 60 and falls back to the default colour", async () => {
    const r = await lensRun("studio", "markers-add", {
      params: { projectId, name: `\u0000Bridge\u001b[31m${"x".repeat(80)}`, timeBeats: 48, colour: "red; background:url(x)" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.marker.name.length, 60);
    assert.ok(r.result.marker.name.startsWith("Bridge[31m"));
    assert.equal(r.result.marker.colour, "#fbbf24");
  });

  it("clamps positions (junk 0, negative 0, huge to the ceiling) and refuses non-finite at the gate", async () => {
    const before = (await list(ctx, projectId)).length;
    // Raw NaN / Infinity and non-finite numeric strings are refused by the lens gate before the macro runs.
    for (const timeBeats of [NaN, Infinity, "1e999", "NaN"]) {
      const r = await lensRun("studio", "markers-add", { params: { projectId, name: "Bad", timeBeats } }, ctx);
      assert.equal(r.result.ok, false, `timeBeats ${String(timeBeats)} should be refused`);
    }
    assert.equal((await list(ctx, projectId)).length, before);
    const cases = [[-1, 0], [true, 0], ["abc", 0], [100001, 100000], ["64", 64]];
    for (const [timeBeats, expected] of cases) {
      const r = await lensRun("studio", "markers-add", { params: { projectId, name: `Pos ${String(timeBeats)}`, timeBeats, lengthBeats: -2 } }, ctx);
      assert.equal(r.ok, true);
      assert.equal(r.result.marker.timeBeats, expected, `timeBeats ${String(timeBeats)}`);
      assert.equal(r.result.marker.lengthBeats, 0);
      await lensRun("studio", "markers-delete", { params: { id: r.result.marker.id } }, ctx);
    }
    assert.equal((await list(ctx, projectId)).length, before);
  });

  it("update validates everything before writing anything", async () => {
    const verse = (await list(ctx, projectId)).find((m) => m.name === "Verse 1");
    const bad = await lensRun("studio", "markers-update", { params: { id: verse.id, name: "\u0000 ", timeBeats: 40 } }, ctx);
    assert.equal(bad.result.ok, false);
    const badColour = await lensRun("studio", "markers-update", { params: { id: verse.id, name: "Verse A", colour: "javascript:" } }, ctx);
    assert.equal(badColour.result.ok, false);
    assert.match(badColour.result.error, /colour must be #rrggbb/);
    const still = (await list(ctx, projectId)).find((m) => m.id === verse.id);
    assert.equal(still.name, "Verse 1");
    assert.equal(still.timeBeats, 8.5);
    const good = await lensRun("studio", "markers-update", { params: { id: verse.id, name: "Verse A", timeBeats: 12, colour: "#34c759" } }, ctx);
    assert.equal(good.ok, true);
    assert.deepEqual([good.result.marker.name, good.result.marker.timeBeats, good.result.marker.colour], ["Verse A", 12, "#34c759"]);
  });

  it("a stranger can neither read, move nor delete another user's sections", async () => {
    const mine = await list(ctx, projectId);
    assert.equal((await list(other, projectId)).length, 0);
    const mv = await lensRun("studio", "markers-update", { params: { id: mine[0].id, name: "Hijack" } }, other);
    assert.equal(mv.result.ok, false);
    const del = await lensRun("studio", "markers-delete", { params: { id: mine[0].id } }, other);
    assert.equal(del.result.ok, false);
    assert.equal((await list(ctx, projectId)).length, mine.length);
  });

  it("delete twice: the second delete is refused", async () => {
    const id = (await list(ctx, projectId))[0].id;
    const a = await lensRun("studio", "markers-delete", { params: { id } }, ctx);
    assert.equal(a.result.deleted, true);
    const b = await lensRun("studio", "markers-delete", { params: { id } }, ctx);
    assert.equal(b.result.ok, false);
  });
});

describe("studio booth — MIDI learn", () => {
  let ctx, other, projectId;
  const maps = async (c, pid) => (await lensRun("studio", "midi-map-list", { params: { projectId: pid } }, c)).result.maps;
  before(async () => {
    ctx = await depthCtx("booth-midi");
    other = await depthCtx("booth-midi-stranger");
    projectId = await newProject(ctx, "Booth MIDI");
  });

  it("learns a fader and rounds/clamps the controller and channel", async () => {
    const r = await lensRun("studio", "midi-map-add", {
      params: { projectId, target: "track:trk_1:volume", msgType: "cc", controller: 7.6, channel: 2.2, rangeMin: -60, rangeMax: 6, deviceName: "nanoKONTROL2" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(
      [r.result.map.controller, r.result.map.channel, r.result.map.rangeMin, r.result.map.rangeMax, r.result.map.deviceName, r.result.replaced],
      [8, 2, -60, 6, "nanoKONTROL2", 0],
    );
  });

  it("re-learning the same knob or the same target replaces the old map (one control, one target)", async () => {
    const knob = await lensRun("studio", "midi-map-add", { params: { projectId, target: "track:trk_1:pan", controller: 8, channel: 2 } }, ctx);
    assert.equal(knob.result.replaced, 1);
    const target = await lensRun("studio", "midi-map-add", { params: { projectId, target: "track:trk_1:pan", controller: 10, channel: 0 } }, ctx);
    assert.equal(target.result.replaced, 1);
    const got = await maps(ctx, projectId);
    assert.deepEqual(got.map((m) => [m.target, m.controller, m.channel]), [["track:trk_1:pan", 10, 0]]);
  });

  it("garbage numbers fall back to safe values, never NaN or Infinity", async () => {
    const huge = await lensRun("studio", "midi-map-add", { params: { projectId, target: "master:volume", controller: "1e999" } }, ctx);
    assert.equal(huge.result.ok, false);
    assert.equal(huge.result.reason, "non_finite_number");
    const r = await lensRun("studio", "midi-map-add", {
      params: { projectId, target: "master:volume", controller: 999, channel: "abc", rangeMin: true, rangeMax: "loud" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual([r.result.map.controller, r.result.map.channel, r.result.map.rangeMin, r.result.map.rangeMax], [127, 0, 0, 1]);
    for (const v of Object.values(r.result.map)) if (typeof v === "number") assert.ok(Number.isFinite(v));
  });

  it("an injection-shaped target is stripped of control characters and capped", async () => {
    const r = await lensRun("studio", "midi-map-add", { params: { projectId, target: `\u0007<script>${"a".repeat(200)}`, controller: 20 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.map.target.length, 120);
    assert.ok(!/[\u0000-\u001f]/.test(r.result.map.target));
    const empty = await lensRun("studio", "midi-map-add", { params: { projectId, target: "\u0000\u0001  " } }, ctx);
    assert.equal(empty.result.ok, false);
  });

  it("a stranger cannot delete my map", async () => {
    const mine = await maps(ctx, projectId);
    const del = await lensRun("studio", "midi-map-delete", { params: { id: mine[0].id } }, other);
    assert.equal(del.result.ok, false);
    assert.equal((await maps(ctx, projectId)).length, mine.length);
  });
});

describe("studio booth — saved chains", () => {
  let ctx, other;
  before(async () => {
    ctx = await depthCtx("booth-racks");
    other = await depthCtx("booth-racks-stranger");
  });

  it("saves a real DAW chain (pitch correct, de-esser, eq8, compressor) and reads it back unchanged", async () => {
    const units = [
      { type: "pitchCorrect", name: "Pitch Correct", wet: 1, params: { retuneMs: 50, humanize: 60, preserveVibrato: 1, scaleName: "minor" } },
      { type: "deesser", wet: 0.8, params: { frequency: 6500, threshold: -24 } },
      { type: "eq8", bypassed: true, params: { b1Gain: -3 } },
      { type: "compressor", params: { threshold: -18, ratio: 3 } },
    ];
    const r = await lensRun("studio", "fx-rack-save", { params: { name: "Lead vocal", units } }, ctx);
    assert.equal(r.ok, true);
    const rack = r.result.rack;
    assert.deepEqual(rack.units.map((u) => [u.type, u.wet, u.bypassed]), [["pitchCorrect", 1, false], ["deesser", 0.8, false], ["eq8", 1, true], ["compressor", 1, false]]);
    assert.deepEqual(rack.units[0].params, { retuneMs: 50, humanize: 60, preserveVibrato: 1, scaleName: "minor" });
    assert.equal(rack.units[0].name, "Pitch Correct");
    const listed = (await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks;
    assert.equal(listed.find((x) => x.id === rack.id).units.length, 4);
  });

  it("drops non-finite numbers, bad keys, objects and clamps wet to 0..1", async () => {
    const r = await lensRun("studio", "fx-rack-save", {
      params: { name: "Dirty", units: [{ type: "reverb", wet: 7, params: { decay: "long", mix: 0.3, size: 1e308, gain: -0, "bad key": 1, __proto__x: 2, nested: { a: 1 }, label: `\u0000Hall${"z".repeat(100)}` } }] },
    }, ctx);
    assert.equal(r.ok, true);
    const u = r.result.rack.units[0];
    assert.equal(u.wet, 1);
    assert.deepEqual(Object.keys(u.params).sort(), ["decay", "gain", "label", "mix", "size"]);
    assert.equal(u.params.decay, "long");
    for (const v of Object.values(u.params)) if (typeof v === "number") assert.ok(Number.isFinite(v));
    assert.equal(u.params.mix, 0.3);
    assert.equal(u.params.label.length, 64);
  });

  it("a non-finite parameter is refused at the gate and writes nothing", async () => {
    const n = (await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks.length;
    const r = await lensRun("studio", "fx-rack-save", { params: { name: "Inf", units: [{ type: "reverb", params: { decay: "1e999" } }] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal((await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks.length, n);
  });

  it("refuses unknown types, empty and oversized racks, and writes nothing", async () => {
    const count = async () => (await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks.length;
    const n = await count();
    assert.equal((await lensRun("studio", "fx-rack-save", { params: { name: "X", units: [{ type: "compressor" }, { type: "bogus" }] } }, ctx)).result.ok, false);
    assert.equal((await lensRun("studio", "fx-rack-save", { params: { name: "X", units: [] } }, ctx)).result.ok, false);
    assert.equal((await lensRun("studio", "fx-rack-save", { params: { name: "X", units: [null] } }, ctx)).result.ok, false);
    const big = await lensRun("studio", "fx-rack-save", { params: { name: "X", units: Array.from({ length: 25 }, () => ({ type: "utility" })) } }, ctx);
    assert.equal(big.result.ok, false);
    assert.match(big.result.error, /at most 24 units/);
    assert.equal((await lensRun("studio", "fx-rack-save", { params: { name: "\u0000 ", units: [{ type: "eq" }] } }, ctx)).result.ok, false);
    assert.equal(await count(), n);
  });

  it("chains are private: a stranger sees none and cannot delete mine", async () => {
    const mine = (await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks;
    assert.equal((await lensRun("studio", "fx-rack-list", {}, other)).result.racks.length, 0);
    const del = await lensRun("studio", "fx-rack-delete", { params: { id: mine[0].id } }, other);
    assert.equal(del.result.ok, false);
    assert.equal((await lensRun("studio", "fx-rack-list", {}, ctx)).result.racks.length, mine.length);
  });
});

describe("studio booth — session edit log", () => {
  it("logging with no session open is a no-op, not an error; a stranger still cannot write into a session", async () => {
    const host = await depthCtx("booth-collab-host");
    const stranger = await depthCtx("booth-collab-stranger");
    const projectId = await newProject(host, "Booth collab");
    const solo = await lensRun("studio", "collab-edit", { params: { projectId, op: "markers-add", target: "mk_1" } }, host);
    assert.equal(solo.ok, true);
    assert.deepEqual([solo.result.logged, solo.result.reason], [false, "no active session"]);
    await lensRun("studio", "collab-session-start", { params: { projectId, displayName: "Host" } }, host);
    const logged = await lensRun("studio", "collab-edit", { params: { projectId, op: "markers-add", target: "mk_1" } }, host);
    assert.equal(logged.result.logged, true);
    assert.equal(logged.result.entry.op, "markers-add");
    const intruder = await lensRun("studio", "collab-edit", { params: { projectId, op: "markers-delete", target: "mk_1" } }, stranger);
    assert.equal(intruder.result.ok, false);
    assert.match(intruder.result.error, /not a collaborator/);
    const since = await lensRun("studio", "collab-since", { params: { projectId, sinceSeq: 0 } }, host);
    assert.deepEqual(since.result.entries.map((e) => e.op), ["markers-add"]);
  });
});
