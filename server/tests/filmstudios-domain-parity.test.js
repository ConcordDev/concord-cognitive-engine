// Contract tests for the film-studios StudioBinder + DaVinci Resolve +
// Frame.io 2026-parity production suite (projects, scenes, breakdown,
// shots, stripboard, call sheets, budget, cast/crew, edit timeline,
// timecoded review).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFilmStudiosActions from "../domains/filmstudios.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`film-studios.${name}`);
  assert.ok(fn, `film-studios.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFilmStudiosActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newProject(ctx = ctxA) {
  const r = call("project-create", ctx, { title: "The Long Cut", format: "feature" });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("film-studios.project-*", () => {
  it("creates, lists and deletes projects with cascade", () => {
    const pid = newProject();
    call("scene-add", ctxA, { projectId: pid, location: "Diner", intExt: "INT" });
    assert.equal(call("project-list", ctxA, {}).result.count, 1);
    assert.equal(call("scene-list", ctxA, { projectId: pid }).result.count, 1);
    call("project-delete", ctxA, { id: pid });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("scene-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("isolates projects per user", () => {
    newProject(ctxA);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
  });
});

describe("film-studios.scene-* and breakdown", () => {
  it("adds scenes with a computed slugline and page totals", () => {
    const pid = newProject();
    const r = call("scene-add", ctxA, {
      projectId: pid, intExt: "EXT", location: "Rooftop", timeOfDay: "NIGHT", pageEighths: 12,
    });
    assert.equal(r.result.scene.slugline, "EXT. Rooftop - NIGHT");
    const list = call("scene-list", ctxA, { projectId: pid });
    assert.equal(list.result.totalPages, 1.5);
  });

  it("tags breakdown elements and summarises by category", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Garage" }).result.scene.id;
    call("breakdown-tag", ctxA, { sceneId: sid, category: "props", name: "Wrench" });
    call("breakdown-tag", ctxA, { sceneId: sid, category: "vehicles", name: "1968 Mustang" });
    const scene = call("scene-list", ctxA, { projectId: pid }).result.scenes[0];
    assert.equal(scene.breakdownElements.length, 2);
    const summary = call("breakdown-summary", ctxA, { projectId: pid });
    assert.equal(summary.result.byCategory.props, 1);
    assert.equal(summary.result.totalElements, 2);
  });

  it("rejects a scene with no location", () => {
    const pid = newProject();
    assert.equal(call("scene-add", ctxA, { projectId: pid, location: "" }).ok, false);
  });
});

describe("film-studios.shot-list", () => {
  it("adds shots to a scene", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Hallway" }).result.scene.id;
    call("shot-add", ctxA, { sceneId: sid, size: "CU", movement: "dolly" });
    call("shot-add", ctxA, { sceneId: sid, size: "WS" });
    assert.equal(call("shot-list", ctxA, { sceneId: sid }).result.count, 2);
    assert.equal(call("shot-list", ctxA, { projectId: pid }).result.count, 2);
  });
});

describe("film-studios.scheduling — stripboard & call sheet", () => {
  it("assigns scenes to shoot days and builds a stripboard", () => {
    const pid = newProject();
    const s1 = call("scene-add", ctxA, { projectId: pid, location: "Bar", pageEighths: 8 }).result.scene.id;
    const s2 = call("scene-add", ctxA, { projectId: pid, location: "Street" }).result.scene.id;
    const day = call("shoot-day-create", ctxA, { projectId: pid, location: "Downtown" }).result.day;
    call("strip-assign", ctxA, { sceneId: s1, shootDayId: day.id });
    const board = call("stripboard", ctxA, { projectId: pid });
    assert.equal(board.result.days[0].sceneCount, 1);
    assert.equal(board.result.days[0].pageEighths, 8);
    assert.equal(board.result.unscheduled.length, 1);
    assert.ok(s2);
  });

  it("generates a call sheet with aggregated cast", () => {
    const pid = newProject();
    const cast = call("cast-add", ctxA, { projectId: pid, name: "Jane Doe", characterName: "RILEY" }).result.member;
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Office", castIds: [cast.id] }).result.scene.id;
    const day = call("shoot-day-create", ctxA, { projectId: pid }).result.day;
    call("strip-assign", ctxA, { sceneId: sid, shootDayId: day.id });
    const sheet = call("call-sheet", ctxA, { shootDayId: day.id });
    assert.equal(sheet.result.sceneCount, 1);
    assert.equal(sheet.result.cast.length, 1);
    assert.equal(sheet.result.cast[0].characterName, "RILEY");
  });
});

describe("film-studios.budget", () => {
  it("adds budget lines and rolls up by department with variance", () => {
    const pid = newProject();
    call("budget-line-add", ctxA, { projectId: pid, department: "production", description: "Camera package", estimated: 5000, actual: 5400 });
    call("budget-line-add", ctxA, { projectId: pid, department: "post_production", description: "Color grade", estimated: 2000, actual: 1800 });
    const b = call("budget-list", ctxA, { projectId: pid });
    assert.equal(b.result.totalEstimated, 7000);
    assert.equal(b.result.totalActual, 7200);
    assert.equal(b.result.variance, 200);
    assert.equal(b.result.byDept.production.actual, 5400);
  });
});

describe("film-studios.cast & crew", () => {
  it("adds and lists cast and crew scoped to a project", () => {
    const pid = newProject();
    call("cast-add", ctxA, { projectId: pid, name: "Actor One", role: "lead", dailyRate: 1200 });
    call("crew-add", ctxA, { projectId: pid, name: "Gaffer Joe", department: "electric", position: "Gaffer" });
    assert.equal(call("cast-list", ctxA, { projectId: pid }).result.count, 1);
    assert.equal(call("crew-list", ctxA, { projectId: pid }).result.count, 1);
  });
});

describe("film-studios.edit timeline", () => {
  it("builds a cut list with running timecode", () => {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel 1", fps: "24" }).result.sequence;
    call("clip-add", ctxA, { sequenceId: seq.id, name: "Establishing", track: "V1", durationSec: 5 });
    call("clip-add", ctxA, { sequenceId: seq.id, name: "Dialogue", track: "V1", durationSec: 10 });
    const cut = call("cut-list", ctxA, { sequenceId: seq.id });
    assert.equal(cut.result.tracks.V1.length, 2);
    assert.equal(cut.result.tracks.V1[0].startTimecode, "00:00:00:00");
    assert.equal(cut.result.tracks.V1[1].startTimecode, "00:00:05:00");
    // 5s + 10s at 24fps = 15s total
    assert.equal(cut.result.totalRuntime, "00:00:15:00");
  });

  it("rejects a clip with no duration", () => {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel 2" }).result.sequence;
    assert.equal(call("clip-add", ctxA, { sequenceId: seq.id, name: "X" }).ok, false);
  });
});

describe("film-studios.review — versions & timecoded notes", () => {
  it("creates versions and timecoded notes, sorted by timecode", () => {
    const pid = newProject();
    const v = call("version-create", ctxA, { projectId: pid, label: "Rough Cut v1", stage: "rough_cut" }).result.version;
    call("note-add", ctxA, { versionId: v.id, timecodeSec: 90, body: "Trim this beat" });
    const n1 = call("note-add", ctxA, { versionId: v.id, timecodeSec: 30, body: "Color is off here" }).result.note;
    const list = call("note-list", ctxA, { versionId: v.id });
    assert.equal(list.result.notes[0].timecodeSec, 30);
    assert.equal(list.result.openCount, 2);
    call("note-resolve", ctxA, { id: n1.id, resolved: true });
    assert.equal(call("note-list", ctxA, { versionId: v.id }).result.openCount, 1);
    assert.equal(call("version-list", ctxA, { projectId: pid }).result.versions[0].openNotes, 1);
  });
});

describe("film-studios.film-dashboard", () => {
  it("rolls up the whole project at a glance", () => {
    const pid = newProject();
    call("scene-add", ctxA, { projectId: pid, location: "Loft", pageEighths: 8 });
    call("cast-add", ctxA, { projectId: pid, name: "Lead" });
    call("budget-line-add", ctxA, { projectId: pid, description: "Lenses", estimated: 3000, actual: 2500 });
    const d = call("film-dashboard", ctxA, { projectId: pid });
    assert.equal(d.result.scenes, 1);
    assert.equal(d.result.pages, 1);
    assert.equal(d.result.cast, 1);
    assert.equal(d.result.budgetEstimated, 3000);
    assert.equal(d.result.budgetActual, 2500);
  });
});

describe("film-studios — locations & screenplay", () => {
  it("manages a locations database; scenes link to a location", () => {
    const pid = newProject();
    const loc = call("location-create", ctxA, { projectId: pid, name: "Rooftop", address: "123 Sky Ave" }).result.location;
    assert.equal(call("location-list", ctxA, { projectId: pid }).result.count, 1);
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Rooftop" }).result.scene.id;
    call("scene-script-set", ctxA, { sceneId: sid, locationId: loc.id, elements: [
      { type: "heading", text: "EXT. ROOFTOP - NIGHT" },
      { type: "action", text: "Rain falls." },
      { type: "character", text: "RILEY" },
      { type: "dialogue", text: "We have to go." },
    ] });
    const got = call("scene-script-get", ctxA, { sceneId: sid });
    assert.equal(got.result.script.length, 4);
    assert.equal(got.result.locationId, loc.id);
    call("location-delete", ctxA, { id: loc.id });
    assert.equal(call("scene-script-get", ctxA, { sceneId: sid }).result.locationId, null);
  });

  it("assembles a screenplay with page count", () => {
    const pid = newProject();
    call("scene-add", ctxA, { projectId: pid, location: "Bar", pageEighths: 12 });
    const sp = call("screenplay", ctxA, { projectId: pid });
    assert.equal(sp.result.sceneCount, 1);
    assert.equal(sp.result.pageCount, 1.5);
  });
});

describe("film-studios — storyboard & DOOD", () => {
  it("attaches storyboard frames to shots", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Hall" }).result.scene.id;
    const shot = call("shot-add", ctxA, { sceneId: sid, size: "CU" }).result.shot;
    call("shot-storyboard-set", ctxA, { shotId: shot.id, imageUrl: "https://example.com/frame.jpg", frameNotes: "push in" });
    assert.equal(call("storyboard", ctxA, { projectId: pid }).result.count, 1);
  });

  it("builds a Day Out of Days matrix", () => {
    const pid = newProject();
    const cast = call("cast-add", ctxA, { projectId: pid, name: "Lead", characterName: "MAX" }).result.member;
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Set", castIds: [cast.id] }).result.scene.id;
    const day = call("shoot-day-create", ctxA, { projectId: pid }).result.day;
    call("strip-assign", ctxA, { sceneId: sid, shootDayId: day.id });
    const dood = call("dood-report", ctxA, { projectId: pid });
    assert.equal(dood.result.rows.length, 1);
    assert.equal(dood.result.rows[0].cells[0].code, "SWF");
  });
});

describe("film-studios — tasks, calendar, markers, approval", () => {
  it("manages production tasks", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "Lock locations", dueDate: "2026-06-01" }).result.task;
    call("task-update", ctxA, { id: t.id, status: "done" });
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.tasks[0].status, "done");
    call("task-delete", ctxA, { id: t.id });
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("production calendar buckets shoot days and tasks", () => {
    const pid = newProject();
    call("shoot-day-create", ctxA, { projectId: pid, date: "2026-06-10" });
    call("task-create", ctxA, { projectId: pid, title: "Wrap", dueDate: "2026-06-12" });
    const cal = call("production-calendar", ctxA, { projectId: pid, year: 2026, month: 6 });
    assert.equal(cal.result.days["10"][0].type, "shoot_day");
    assert.equal(cal.result.days["12"][0].type, "task");
  });

  it("adds timeline markers and sets version approval status", () => {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel 1" }).result.sequence;
    call("marker-add", ctxA, { sequenceId: seq.id, label: "Music in", frame: 240 });
    assert.equal(call("marker-list", ctxA, { sequenceId: seq.id }).result.count, 1);
    const v = call("version-create", ctxA, { projectId: pid, label: "Cut 1" }).result.version;
    call("version-set-status", ctxA, { id: v.id, status: "approved" });
    assert.equal(call("version-list", ctxA, { projectId: pid }).result.versions[0].approvalStatus, "approved");
  });

  it("element-list report groups breakdown elements", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Garage" }).result.scene.id;
    call("breakdown-tag", ctxA, { sceneId: sid, category: "props", name: "Wrench" });
    const rep = call("element-list-report", ctxA, { projectId: pid });
    assert.equal(rep.result.totalElements, 1);
    assert.equal(rep.result.byCategory.props[0].name, "Wrench");
  });
});

// ── Feature-parity backlog ────────────────────────────────────────────

describe("film-studios — NLE timeline trim / ripple / reorder", () => {
  function seqWithClips() {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel", fps: "24" }).result.sequence;
    const c1 = call("clip-add", ctxA, { sequenceId: seq.id, name: "A", track: "V1", durationSec: 5 }).result.clip;
    const c2 = call("clip-add", ctxA, { sequenceId: seq.id, name: "B", track: "V1", durationSec: 10 }).result.clip;
    return { pid, seq, c1, c2 };
  }

  it("trims a clip via in/out points and updates duration", () => {
    const { c1 } = seqWithClips();
    const r = call("clip-update", ctxA, { id: c1.id, inFrame: 24, outFrame: 72 });
    assert.equal(r.ok, true);
    assert.equal(r.result.clip.durationFrames, 48);
  });

  it("updates transition and track on a clip", () => {
    const { c1 } = seqWithClips();
    const r = call("clip-update", ctxA, { id: c1.id, transition: "dissolve", track: "V2" });
    assert.equal(r.result.clip.transition, "dissolve");
    assert.equal(r.result.clip.track, "V2");
  });

  it("reorders clips on a track", () => {
    const { seq, c1, c2 } = seqWithClips();
    const r = call("clip-reorder", ctxA, { sequenceId: seq.id, track: "V1", clipIds: [c2.id, c1.id] });
    assert.equal(r.ok, true);
    const cut = call("cut-list", ctxA, { sequenceId: seq.id });
    assert.equal(cut.result.tracks.V1[0].name, "B");
  });

  it("ripple-deletes a clip and closes the gap", () => {
    const { seq, c1, c2 } = seqWithClips();
    const r = call("clip-ripple-delete", ctxA, { id: c1.id });
    assert.equal(r.ok, true);
    const cut = call("cut-list", ctxA, { sequenceId: seq.id });
    assert.equal(cut.result.tracks.V1.length, 1);
    assert.equal(cut.result.tracks.V1[0].startTimecode, "00:00:00:00");
    assert.ok(c2);
  });
});

describe("film-studios — collaborative script revisions & locks", () => {
  it("creates revisions with auto-assigned production colors", () => {
    const pid = newProject();
    const r1 = call("revision-create", ctxA, { projectId: pid, label: "Draft" }).result.revision;
    const r2 = call("revision-create", ctxA, { projectId: pid, label: "Blue Pages" }).result.revision;
    assert.equal(r1.color, "white");
    assert.equal(r2.color, "blue");
    assert.equal(call("revision-list", ctxA, { projectId: pid }).result.count, 2);
  });

  it("toggles page locks on a revision", () => {
    const pid = newProject();
    const rev = call("revision-create", ctxA, { projectId: pid, label: "v2" }).result.revision;
    let r = call("page-lock-toggle", ctxA, { revisionId: rev.id, page: "12" });
    assert.equal(r.result.locked, true);
    assert.deepEqual(r.result.lockedPages, ["12"]);
    r = call("page-lock-toggle", ctxA, { revisionId: rev.id, page: "12" });
    assert.equal(r.result.locked, false);
  });

  it("tags a scene with a revision color", () => {
    const pid = newProject();
    const rev = call("revision-create", ctxA, { projectId: pid, label: "pink", color: "pink" }).result.revision;
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Set" }).result.scene.id;
    const r = call("scene-revision-tag", ctxA, { sceneId: sid, revisionId: rev.id });
    assert.equal(r.result.revisionColor, "pink");
  });
});

describe("film-studios — shot/storyboard drag-link", () => {
  it("relinks a shot to another scene", () => {
    const pid = newProject();
    const s1 = call("scene-add", ctxA, { projectId: pid, location: "Hall" }).result.scene.id;
    const s2 = call("scene-add", ctxA, { projectId: pid, location: "Yard" }).result.scene.id;
    const shot = call("shot-add", ctxA, { sceneId: s1, size: "CU" }).result.shot;
    const r = call("shot-relink-scene", ctxA, { shotId: shot.id, sceneId: s2 });
    assert.equal(r.result.sceneId, s2);
    assert.equal(call("shot-list", ctxA, { sceneId: s2 }).result.count, 1);
  });

  it("reorders storyboard frames and builds a board sequence", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Roof" }).result.scene.id;
    const a = call("shot-add", ctxA, { sceneId: sid, size: "WS" }).result.shot;
    const b = call("shot-add", ctxA, { sceneId: sid, size: "CU" }).result.shot;
    call("shot-storyboard-set", ctxA, { shotId: a.id, imageUrl: "https://x.com/a.jpg" });
    call("storyboard-reorder", ctxA, { sceneId: sid, shotIds: [b.id, a.id] });
    const board = call("shot-board-sequence", ctxA, { sceneId: sid });
    assert.equal(board.result.frames[0].shotId, b.id);
    assert.equal(board.result.framedCount, 1);
  });
});

describe("film-studios — watch-party sync & chat", () => {
  it("creates a party, syncs playback and posts chat", () => {
    const pid = newProject();
    const party = call("party-create", ctxA, { projectId: pid, title: "First Cut Screening" }).result.party;
    assert.ok(party.code.startsWith("FILM-"));
    call("party-sync", ctxA, { id: party.id, playing: true, positionSec: 42 });
    const st = call("party-state", ctxA, { id: party.id });
    assert.equal(st.result.party.playing, true);
    assert.ok(st.result.party.positionSec >= 42);
    call("party-chat-post", ctxA, { id: party.id, author: "Dana", text: "Love this beat", atSec: 42 });
    const chat = call("party-chat-list", ctxA, { id: party.id });
    assert.equal(chat.result.count, 1);
    assert.equal(chat.result.messages[0].text, "Love this beat");
  });

  it("lists and deletes parties", () => {
    const pid = newProject();
    const party = call("party-create", ctxA, { projectId: pid, title: "P" }).result.party;
    assert.equal(call("party-list", ctxA, { projectId: pid }).result.count, 1);
    call("party-delete", ctxA, { id: party.id });
    assert.equal(call("party-list", ctxA, { projectId: pid }).result.count, 0);
  });
});

describe("film-studios — budget actuals & cost report", () => {
  it("updates budget actuals and produces a cost report", () => {
    const pid = newProject();
    const line = call("budget-line-add", ctxA, {
      projectId: pid, department: "production", description: "Grip truck", estimated: 2000,
    }).result.line;
    call("budget-line-update", ctxA, { id: line.id, actual: 2600 });
    const rep = call("cost-report", ctxA, { projectId: pid });
    assert.equal(rep.result.totalActual, 2600);
    assert.equal(rep.result.variance, 600);
    assert.equal(rep.result.overBudget, true);
    assert.equal(rep.result.overrunLines, 1);
    assert.equal(rep.result.lines[0].status, "over");
  });
});

describe("film-studios — multicam / proxy media", () => {
  it("registers media with proxy and lists with proxy count", () => {
    const pid = newProject();
    call("media-register", ctxA, {
      projectId: pid, name: "A-CAM 0001", kind: "video",
      sourceUrl: "https://x.com/a.mov", proxyUrl: "https://x.com/a-proxy.mov", camera: "A",
    });
    const list = call("media-list", ctxA, { projectId: pid });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.proxyCount, 1);
    assert.equal(list.result.media[0].quality, "proxy");
  });

  it("groups media into a multicam set and attaches to a clip", () => {
    const pid = newProject();
    const m1 = call("media-register", ctxA, { projectId: pid, name: "A-CAM", camera: "A" }).result.media;
    const m2 = call("media-register", ctxA, { projectId: pid, name: "B-CAM", camera: "B" }).result.media;
    const grp = call("multicam-group", ctxA, { projectId: pid, name: "Interview", mediaIds: [m1.id, m2.id] }).result.group;
    assert.equal(grp.angleCount, 2);
    assert.equal(call("multicam-list", ctxA, { projectId: pid }).result.groups[0].angles.length, 2);
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "S" }).result.sequence;
    const clip = call("clip-add", ctxA, { sequenceId: seq.id, name: "C", durationSec: 3 }).result.clip;
    const r = call("clip-set-media", ctxA, { clipId: clip.id, mediaId: m1.id, mcamAngle: 1 });
    assert.equal(r.result.mediaId, m1.id);
    assert.equal(r.result.mcamAngle, 1);
  });

  it("rejects a multicam group with fewer than 2 media", () => {
    const pid = newProject();
    const m1 = call("media-register", ctxA, { projectId: pid, name: "Solo" }).result.media;
    assert.equal(call("multicam-group", ctxA, { projectId: pid, name: "X", mediaIds: [m1.id] }).ok, false);
  });
});

describe("film-studios — festival submission tracker", () => {
  it("submits to festivals and rolls up status counts", () => {
    const pid = newProject();
    const sub = call("festival-submit", ctxA, {
      projectId: pid, festival: "Sundance", category: "Short Film", fee: 65, deadline: "2026-09-01",
    }).result.submission;
    assert.equal(sub.status, "researching");
    call("festival-update", ctxA, { id: sub.id, status: "submitted", submittedDate: "2026-08-15" });
    const list = call("festival-list", ctxA, { projectId: pid });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalFees, 65);
    assert.equal(list.result.pending, 1);
    call("festival-delete", ctxA, { id: sub.id });
    assert.equal(call("festival-list", ctxA, { projectId: pid }).result.count, 0);
  });
});
