// tests/depth/film-studios-behavior.test.js — REAL behavioral tests for the
// film-studios domain (registerLensAction family, invoked via lensRun).
//
// Q63 tranche 3 (GH #850): the 54 film-studios macros the macro-depth
// grader carried as important but untested at the Q27 regeneration
// (87800ce54). Every test drives the domain's own actions through the
// depth harness against the per-user STATE.filmLens / filmLensX stores
// and asserts on returned state: CRUD round-trips, exact aggregations
// (page eighths, budget variance, call-sheet joins), ordering rules,
// coercion fallbacks, and the handlers' own validation refusals.
// Seeding uses the domain's create actions; every lensRun("film-studios",
// "<macro>", …) call literally names its macro so the grader credits it.
//
// lens.run unwrapping (per _harness): a handler's { ok:true, result }
// comes back as-is; a handler refusal { ok:false, error } comes back at
// the top level (r.ok false, r.error set). Skipped: the artifact-data
// calc macros and `vision` (LLM) — already covered / not state macros.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

async function seedProject(ctx, title = "Night Shoot") {
  const r = await lensRun("film-studios", "project-create", { params: { title } }, ctx);
  assert.equal(r.ok, true);
  return r.result.project.id;
}
async function seedScene(ctx, projectId, params = {}) {
  const r = await lensRun("film-studios", "scene-add", { params: { projectId, location: "Back Lot", ...params } }, ctx);
  assert.equal(r.ok, true);
  return r.result.scene;
}
async function seedSequence(ctx, projectId, params = {}) {
  const r = await lensRun("film-studios", "sequence-create", { params: { projectId, name: "Assembly", ...params } }, ctx);
  assert.equal(r.ok, true);
  return r.result.sequence;
}

describe("film-studios — projects and scenes", () => {
  let ctx; let projectId; let sceneA; let sceneB;
  before(async () => {
    ctx = await depthCtx("q63-film-scenes");
    projectId = await seedProject(ctx);
    sceneA = await seedScene(ctx, projectId, { intExt: "INT", location: "Diner", timeOfDay: "NIGHT", pageEighths: 8 });
    sceneB = await seedScene(ctx, projectId, { intExt: "EXT", location: "Rooftop", timeOfDay: "DAY", pageEighths: 8 });
  });

  it("project-list returns the caller's projects and none of another user's", async () => {
    const mine = await lensRun("film-studios", "project-list", {}, ctx);
    assert.equal(mine.ok, true);
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.projects[0].id, projectId);
    assert.equal(mine.result.projects[0].format, "feature");
    const other = await depthCtx("q63-film-scenes-other");
    const theirs = await lensRun("film-studios", "project-list", {}, other);
    assert.equal(theirs.result.count, 0);
  });

  it("scene-list composes sluglines and totals page eighths into pages", async () => {
    const r = await lensRun("film-studios", "scene-list", { params: { projectId } }, ctx);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.totalPages, 2); // 16 eighths = 2 pages exactly
    const diner = r.result.scenes.find((s) => s.id === sceneA.id);
    assert.equal(diner.slugline, "INT. Diner - NIGHT");
    assert.deepEqual(diner.breakdownElements, []);
    assert.equal(diner.shootDayNumber, null);
  });

  it("scene-update applies picks, cleans strings, and keeps the current value on a bad pick", async () => {
    const r = await lensRun("film-studios", "scene-update", { params: { id: sceneA.id, timeOfDay: "DAWN", pageEighths: 12.4, intExt: "SIDEWAYS" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.scene.timeOfDay, "DAWN");
    assert.equal(r.result.scene.pageEighths, 12); // rounded
    assert.equal(r.result.scene.intExt, "INT"); // invalid pick falls back to current
    assert.equal(r.result.scene.slugline, "INT. Diner - DAWN");
    const ghost = await lensRun("film-studios", "scene-update", { params: { id: "scn_nope", location: "X" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "scene not found");
  });

  it("breakdown-untag removes a tagged element and refuses a second removal", async () => {
    const tag = await lensRun("film-studios", "breakdown-tag", { params: { sceneId: sceneB.id, name: "Rain machine", category: "sfx" } }, ctx);
    assert.equal(tag.ok, true);
    const elId = tag.result.element.id;
    const listed = await lensRun("film-studios", "scene-list", { params: { projectId } }, ctx);
    assert.equal(listed.result.scenes.find((s) => s.id === sceneB.id).breakdownElements.length, 1);
    const un = await lensRun("film-studios", "breakdown-untag", { params: { id: elId } }, ctx);
    assert.equal(un.ok, true);
    assert.equal(un.result.deleted, elId);
    const again = await lensRun("film-studios", "breakdown-untag", { params: { id: elId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "element not found");
  });

  it("scene-delete cascades to breakdown elements and shots, then refuses a repeat", async () => {
    const doomed = await seedScene(ctx, projectId, { location: "Alley" });
    await lensRun("film-studios", "breakdown-tag", { params: { sceneId: doomed.id, name: "Dumpster", category: "set_dressing" } }, ctx);
    await lensRun("film-studios", "shot-add", { params: { sceneId: doomed.id } }, ctx);
    const del = await lensRun("film-studios", "scene-delete", { params: { id: doomed.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, doomed.id);
    const shots = await lensRun("film-studios", "shot-list", { params: { projectId } }, ctx);
    assert.equal(shots.result.count, 0);
    const report = await lensRun("film-studios", "element-list-report", { params: { projectId } }, ctx);
    assert.equal(report.result.totalElements, 0);
    const again = await lensRun("film-studios", "scene-delete", { params: { id: doomed.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "scene not found");
  });
});

describe("film-studios — shots and storyboard links", () => {
  let ctx; let projectId; let sceneA; let sceneB; let shot1; let shot2;
  before(async () => {
    ctx = await depthCtx("q63-film-shots");
    projectId = await seedProject(ctx);
    sceneA = await seedScene(ctx, projectId, { location: "Office" });
    sceneB = await seedScene(ctx, projectId, { location: "Garage" });
    const s1 = await lensRun("film-studios", "shot-add", { params: { sceneId: sceneA.id, size: "CU" } }, ctx);
    shot1 = s1.result.shot;
    const s2 = await lensRun("film-studios", "shot-add", { params: { sceneId: sceneA.id, size: "WS" } }, ctx);
    shot2 = s2.result.shot;
  });

  it("shot-list filters by scene and reports counts", async () => {
    const r = await lensRun("film-studios", "shot-list", { params: { sceneId: sceneA.id } }, ctx);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.shots[0].number, "1"); // auto-numbered per scene
    assert.equal(r.result.shots[1].number, "2");
    const empty = await lensRun("film-studios", "shot-list", { params: { sceneId: sceneB.id } }, ctx);
    assert.equal(empty.result.count, 0);
  });

  it("shot-storyboard-set validates the URL scheme and stores the frame", async () => {
    const bad = await lensRun("film-studios", "shot-storyboard-set", { params: { shotId: shot1.id, imageUrl: "ftp://frames/1.png" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "imageUrl must be http(s)");
    const good = await lensRun("film-studios", "shot-storyboard-set", { params: { shotId: shot1.id, imageUrl: "https://frames.example/1.png", frameNotes: "tight on hands" } }, ctx);
    assert.equal(good.ok, true);
    assert.equal(good.result.storyboardUrl, "https://frames.example/1.png");
    const ghost = await lensRun("film-studios", "shot-storyboard-set", { params: { shotId: "sht_nope", imageUrl: "https://x/y.png" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "shot not found");
  });

  it("storyboard-reorder assigns board order read back by shot-board-sequence", async () => {
    const r = await lensRun("film-studios", "storyboard-reorder", { params: { sceneId: sceneA.id, shotIds: [shot2.id, shot1.id] } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const seq = await lensRun("film-studios", "shot-board-sequence", { params: { sceneId: sceneA.id } }, ctx);
    assert.equal(seq.result.frames[0].shotId, shot2.id);
    assert.equal(seq.result.frames[0].position, 1);
    assert.equal(seq.result.framedCount, 1); // only shot1 carries a storyboard URL
    const empty = await lensRun("film-studios", "storyboard-reorder", { params: { sceneId: sceneA.id, shotIds: [] } }, ctx);
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "shotIds array required");
  });

  it("shot-relink-scene moves the shot to the target scene and renumbers it there", async () => {
    const r = await lensRun("film-studios", "shot-relink-scene", { params: { shotId: shot2.id, sceneId: sceneB.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.sceneId, sceneB.id);
    const inB = await lensRun("film-studios", "shot-list", { params: { sceneId: sceneB.id } }, ctx);
    assert.equal(inB.result.count, 1);
    assert.equal(inB.result.shots[0].number, "1"); // first shot of its new scene
    const badScene = await lensRun("film-studios", "shot-relink-scene", { params: { shotId: shot1.id, sceneId: "scn_nope" } }, ctx);
    assert.equal(badScene.ok, false);
    assert.equal(badScene.error, "scene not found");
  });

  it("shot-delete removes the shot and refuses a repeat", async () => {
    const del = await lensRun("film-studios", "shot-delete", { params: { id: shot1.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "shot-delete", { params: { id: shot1.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "shot not found");
  });
});

describe("film-studios — stripboard, call sheet, budget", () => {
  let ctx; let projectId; let sceneA; let sceneB; let day; let castId; let lineId;
  before(async () => {
    ctx = await depthCtx("q63-film-sched");
    projectId = await seedProject(ctx);
    const cast = await lensRun("film-studios", "cast-add", { params: { projectId, name: "Ana Ruiz", characterName: "MARA", role: "lead" } }, ctx);
    castId = cast.result.member.id;
    sceneA = await seedScene(ctx, projectId, { location: "Diner", pageEighths: 6, castIds: [castId] });
    sceneB = await seedScene(ctx, projectId, { location: "Motel", pageEighths: 4 });
    const d = await lensRun("film-studios", "shoot-day-create", { params: { projectId, date: "2026-03-05", location: "Back Lot", generalCall: "06:00" } }, ctx);
    day = d.result.day;
    await lensRun("film-studios", "crew-add", { params: { projectId, name: "Sam Okafor", department: "camera", position: "DP" } }, ctx);
    const line = await lensRun("film-studios", "budget-line-add", { params: { projectId, department: "production", description: "Camera rental", estimated: 1000, actual: 1250.5 } }, ctx);
    lineId = line.result.line.id;
    await lensRun("film-studios", "budget-line-add", { params: { projectId, department: "post_production", description: "Color suite", estimated: 500, actual: 0 } }, ctx);
  });

  it("strip-assign schedules and unschedules a scene; bad day and scene ids refuse", async () => {
    const badDay = await lensRun("film-studios", "strip-assign", { params: { sceneId: sceneA.id, shootDayId: "day_nope" } }, ctx);
    assert.equal(badDay.ok, false);
    assert.equal(badDay.error, "shoot day not found");
    const badScene = await lensRun("film-studios", "strip-assign", { params: { sceneId: "scn_nope", shootDayId: day.id } }, ctx);
    assert.equal(badScene.ok, false);
    assert.equal(badScene.error, "scene not found");
    const on = await lensRun("film-studios", "strip-assign", { params: { sceneId: sceneA.id, shootDayId: day.id, stripOrder: 2 } }, ctx);
    assert.equal(on.result.shootDayId, day.id);
    await lensRun("film-studios", "strip-assign", { params: { sceneId: sceneB.id, shootDayId: day.id, stripOrder: 1 } }, ctx);
    const off = await lensRun("film-studios", "strip-assign", { params: { sceneId: sceneB.id } }, ctx);
    assert.equal(off.result.shootDayId, null);
    await lensRun("film-studios", "strip-assign", { params: { sceneId: sceneB.id, shootDayId: day.id, stripOrder: 1 } }, ctx);
  });

  it("stripboard groups scenes by day in strip order with page totals and the unscheduled tail", async () => {
    const free = await seedScene(ctx, projectId, { location: "Airport", pageEighths: 2 });
    const r = await lensRun("film-studios", "stripboard", { params: { projectId } }, ctx);
    assert.equal(r.result.scheduledCount, 2);
    assert.equal(r.result.days.length, 1);
    assert.equal(r.result.days[0].sceneCount, 2);
    assert.equal(r.result.days[0].pageEighths, 10); // 6 + 4
    assert.equal(r.result.days[0].scenes[0].id, sceneB.id); // stripOrder 1 before 2
    assert.equal(r.result.unscheduled.length, 1);
    assert.equal(r.result.unscheduled[0].id, free.id);
  });

  it("call-sheet joins the day's scenes, cast, and crew with total pages", async () => {
    const r = await lensRun("film-studios", "call-sheet", { params: { shootDayId: day.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.day.dayNumber, 1);
    assert.equal(r.result.day.generalCall, "06:00");
    assert.equal(r.result.sceneCount, 2);
    assert.equal(r.result.totalPageEighths, 10);
    assert.equal(r.result.cast.length, 1);
    assert.equal(r.result.cast[0].characterName, "MARA");
    assert.equal(r.result.crew.length, 1);
    assert.equal(r.result.crew[0].position, "DP");
    const ghost = await lensRun("film-studios", "call-sheet", { params: { shootDayId: "day_nope" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "shoot day not found");
  });

  it("budget-list aggregates by department with totals and variance", async () => {
    const r = await lensRun("film-studios", "budget-list", { params: { projectId } }, ctx);
    assert.equal(r.result.totalEstimated, 1500);
    assert.equal(r.result.totalActual, 1250.5);
    assert.equal(r.result.variance, -249.5);
    assert.equal(r.result.byDept.production.estimated, 1000);
    assert.equal(r.result.byDept.post_production.actual, 0);
    assert.equal(r.result.byDept.marketing.estimated, 0); // zero-filled departments
  });

  it("budget-line-update moves actuals and keeps the department on a bad pick", async () => {
    const r = await lensRun("film-studios", "budget-line-update", { params: { id: lineId, actual: 1100, department: "space" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.line.actual, 1100);
    assert.equal(r.result.line.department, "production");
    const ghost = await lensRun("film-studios", "budget-line-update", { params: { id: "bdg_nope", actual: 1 } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "budget line not found");
  });

  it("budget-line-delete, cast-delete, and crew-delete remove rows and refuse repeats", async () => {
    const del = await lensRun("film-studios", "budget-line-delete", { params: { id: lineId } }, ctx);
    assert.equal(del.result.deleted, lineId);
    const again = await lensRun("film-studios", "budget-line-delete", { params: { id: lineId } }, ctx);
    assert.equal(again.error, "budget line not found");
    const cast = await lensRun("film-studios", "cast-add", { params: { projectId, name: "Temp Actor" } }, ctx);
    const cd = await lensRun("film-studios", "cast-delete", { params: { id: cast.result.member.id } }, ctx);
    assert.equal(cd.ok, true);
    const cdAgain = await lensRun("film-studios", "cast-delete", { params: { id: cast.result.member.id } }, ctx);
    assert.equal(cdAgain.error, "cast member not found");
    const crew = await lensRun("film-studios", "crew-add", { params: { projectId, name: "Temp Grip" } }, ctx);
    const kd = await lensRun("film-studios", "crew-delete", { params: { id: crew.result.member.id } }, ctx);
    assert.equal(kd.ok, true);
    const kdAgain = await lensRun("film-studios", "crew-delete", { params: { id: crew.result.member.id } }, ctx);
    assert.equal(kdAgain.error, "crew member not found");
  });

  it("shoot-day-delete unassigns its scenes and refuses a repeat", async () => {
    const del = await lensRun("film-studios", "shoot-day-delete", { params: { id: day.id } }, ctx);
    assert.equal(del.ok, true);
    const board = await lensRun("film-studios", "stripboard", { params: { projectId } }, ctx);
    assert.equal(board.result.scheduledCount, 0);
    assert.equal(board.result.days.length, 0);
    const again = await lensRun("film-studios", "shoot-day-delete", { params: { id: day.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "shoot day not found");
  });
});

describe("film-studios — edit timeline: sequences, clips, markers", () => {
  let ctx; let projectId; let seq; let clip1; let clip2; let clip3;
  before(async () => {
    ctx = await depthCtx("q63-film-edit");
    projectId = await seedProject(ctx);
    seq = await seedSequence(ctx, projectId, { fps: "24" });
    const c1 = await lensRun("film-studios", "clip-add", { params: { sequenceId: seq.id, name: "Open", durationFrames: 48 } }, ctx);
    clip1 = c1.result.clip;
  });

  it("clip-add derives frames from seconds at the sequence fps and orders per track", async () => {
    const c2 = await lensRun("film-studios", "clip-add", { params: { sequenceId: seq.id, name: "Chase", durationSec: 2 } }, ctx);
    assert.equal(c2.ok, true);
    clip2 = c2.result.clip;
    assert.equal(clip2.durationFrames, 48); // 2s × 24fps
    assert.equal(clip2.order, 1); // second clip on V1
    const a1 = await lensRun("film-studios", "clip-add", { params: { sequenceId: seq.id, name: "Score", track: "A1", durationFrames: 96 } }, ctx);
    clip3 = a1.result.clip;
    assert.equal(clip3.order, 0); // first clip on its own track
    const noDur = await lensRun("film-studios", "clip-add", { params: { sequenceId: seq.id, name: "Empty" } }, ctx);
    assert.equal(noDur.ok, false);
    assert.equal(noDur.error, "clip duration required");
    const ghost = await lensRun("film-studios", "clip-add", { params: { sequenceId: "seq_nope", name: "X", durationFrames: 10 } }, ctx);
    assert.equal(ghost.error, "sequence not found");
  });

  it("sequence-list annotates each sequence with its clip count", async () => {
    const r = await lensRun("film-studios", "sequence-list", { params: { projectId } }, ctx);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.sequences[0].clipCount, 3);
    assert.equal(r.result.sequences[0].fps, "24");
  });

  it("clip-reorder rewrites track order; empty id list refuses", async () => {
    const r = await lensRun("film-studios", "clip-reorder", { params: { sequenceId: seq.id, track: "V1", clipIds: [clip2.id, clip1.id] } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const list = await lensRun("film-studios", "clip-list", { params: { sequenceId: seq.id } }, ctx);
    const v1 = list.result.clips.filter((c) => c.track === "V1");
    assert.equal(v1[0].id, clip2.id);
    assert.equal(v1[1].id, clip1.id);
    const empty = await lensRun("film-studios", "clip-reorder", { params: { sequenceId: seq.id, clipIds: [] } }, ctx);
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "clipIds array required");
  });

  it("clip-ripple-delete closes the order gap on the track", async () => {
    const del = await lensRun("film-studios", "clip-ripple-delete", { params: { id: clip2.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.rippled, 1); // one V1 clip remains and re-orders
    const list = await lensRun("film-studios", "clip-list", { params: { sequenceId: seq.id } }, ctx);
    const v1 = list.result.clips.filter((c) => c.track === "V1");
    assert.equal(v1.length, 1);
    assert.equal(v1[0].order, 0);
    const again = await lensRun("film-studios", "clip-ripple-delete", { params: { id: clip2.id } }, ctx);
    assert.equal(again.error, "clip not found");
  });

  it("clip-delete removes a clip outright and refuses a repeat", async () => {
    const del = await lensRun("film-studios", "clip-delete", { params: { id: clip3.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "clip-delete", { params: { id: clip3.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "clip not found");
  });

  it("marker-add and marker-delete manage timeline markers on the sequence", async () => {
    const bad = await lensRun("film-studios", "marker-add", { params: { sequenceId: seq.id, label: "" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "marker label required");
    const add = await lensRun("film-studios", "marker-add", { params: { sequenceId: seq.id, label: "Act break", frame: 240 } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.marker.frame, 240);
    assert.equal(add.result.marker.color, "amber"); // default color
    const del = await lensRun("film-studios", "marker-delete", { params: { id: add.result.marker.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "marker-delete", { params: { id: add.result.marker.id } }, ctx);
    assert.equal(again.error, "marker not found");
  });
});

describe("film-studios — review: versions and notes", () => {
  let ctx; let projectId; let versionId;
  before(async () => {
    ctx = await depthCtx("q63-film-review");
    projectId = await seedProject(ctx);
    const v = await lensRun("film-studios", "version-create", { params: { projectId, label: "Rough cut 1", runtimeSec: 5400 } }, ctx);
    versionId = v.result.version.id;
  });

  it("note-add files timecoded notes; note-list sorts by timecode and counts open", async () => {
    const badVersion = await lensRun("film-studios", "note-add", { params: { versionId: "ver_nope", body: "hi" } }, ctx);
    assert.equal(badVersion.ok, false);
    assert.equal(badVersion.error, "version not found");
    const late = await lensRun("film-studios", "note-add", { params: { versionId, body: "Trim the pause", timecodeSec: 300 } }, ctx);
    assert.equal(late.ok, true);
    await lensRun("film-studios", "note-add", { params: { versionId, body: "Cold open lands", timecodeSec: 12 } }, ctx);
    const r = await lensRun("film-studios", "note-list", { params: { versionId } }, ctx);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.openCount, 2);
    assert.equal(r.result.notes[0].timecodeSec, 12); // sorted ascending
    assert.equal(r.result.notes[0].author, "Reviewer"); // default author
  });

  it("note-resolve flips resolution and version-list reflects open counts", async () => {
    const list = await lensRun("film-studios", "note-list", { params: { versionId } }, ctx);
    const target = list.result.notes[0];
    const r = await lensRun("film-studios", "note-resolve", { params: { id: target.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.note.resolved, true); // default: resolve unless resolved === false
    const back = await lensRun("film-studios", "note-resolve", { params: { id: target.id, resolved: false } }, ctx);
    assert.equal(back.result.note.resolved, false);
    await lensRun("film-studios", "note-resolve", { params: { id: target.id } }, ctx);
    const versions = await lensRun("film-studios", "version-list", { params: { projectId } }, ctx);
    assert.equal(versions.result.count, 1);
    assert.equal(versions.result.versions[0].noteCount, 2);
    assert.equal(versions.result.versions[0].openNotes, 1);
    const ghost = await lensRun("film-studios", "note-resolve", { params: { id: "not_nope" } }, ctx);
    assert.equal(ghost.error, "note not found");
  });

  it("version-set-status applies valid statuses and falls back to in_review", async () => {
    const ok = await lensRun("film-studios", "version-set-status", { params: { id: versionId, status: "approved" } }, ctx);
    assert.equal(ok.result.approvalStatus, "approved");
    const bad = await lensRun("film-studios", "version-set-status", { params: { id: versionId, status: "shipped" } }, ctx);
    assert.equal(bad.result.approvalStatus, "in_review"); // invalid value coerces to the default
    const ghost = await lensRun("film-studios", "version-set-status", { params: { id: "ver_nope", status: "approved" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "version not found");
  });
});

describe("film-studios — screenplay, locations, tasks, calendar", () => {
  let ctx; let projectId; let scene; let locationId; let taskId;
  before(async () => {
    ctx = await depthCtx("q63-film-script");
    projectId = await seedProject(ctx);
    scene = await seedScene(ctx, projectId, { intExt: "INT", location: "Loft", timeOfDay: "DAY", pageEighths: 8 });
    const loc = await lensRun("film-studios", "location-create", { params: { projectId, name: "Sunset Loft", address: "12 Roof Ave" } }, ctx);
    locationId = loc.result.location.id;
    const task = await lensRun("film-studios", "task-create", { params: { projectId, title: "Permit filing", dueDate: "2026-03-05" } }, ctx);
    taskId = task.result.task.id;
    await lensRun("film-studios", "shoot-day-create", { params: { projectId, date: "2026-03-05" } }, ctx);
  });

  it("scene-script-set coerces unknown element types to action and validates the location link", async () => {
    const r = await lensRun("film-studios", "scene-script-set", { params: { sceneId: scene.id, locationId, elements: [
      { type: "heading", text: "INT. LOFT - DAY" },
      { type: "singing", text: "Mara hums." },
      { type: "dialogue", text: "We shoot at dawn." },
    ] } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.elementCount, 3);
    const get = await lensRun("film-studios", "scene-script-get", { params: { sceneId: scene.id } }, ctx);
    assert.equal(get.result.script[1].type, "action"); // unknown type coerced
    assert.equal(get.result.locationId, locationId);
    const ghostLoc = await lensRun("film-studios", "scene-script-set", { params: { sceneId: scene.id, locationId: "loc_nope", elements: [] } }, ctx);
    assert.equal(ghostLoc.result.elementCount, 0);
    const get2 = await lensRun("film-studios", "scene-script-get", { params: { sceneId: scene.id } }, ctx);
    assert.equal(get2.result.locationId, null); // unknown location unlinks rather than storing a ghost id
  });

  it("screenplay assembles scenes with sluglines, scripts, and a page count", async () => {
    await lensRun("film-studios", "scene-script-set", { params: { sceneId: scene.id, elements: [{ type: "action", text: "Rain on glass." }] } }, ctx);
    const r = await lensRun("film-studios", "screenplay", { params: { projectId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.sceneCount, 1);
    assert.equal(r.result.pageCount, 1); // 8 eighths = 1 page
    assert.equal(r.result.scenes[0].slugline, "INT. Loft - DAY");
    assert.equal(r.result.scenes[0].script[0].text, "Rain on glass.");
    const ghost = await lensRun("film-studios", "screenplay", { params: { projectId: "prj_nope" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "project not found");
  });

  it("location-update edits fields; location-delete unlinks scenes and refuses a repeat", async () => {
    const up = await lensRun("film-studios", "location-update", { params: { id: locationId, contact: "Pat (locations)" } }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.location.contact, "Pat (locations)");
    assert.equal(up.result.location.name, "Sunset Loft"); // untouched field preserved
    await lensRun("film-studios", "scene-script-set", { params: { sceneId: scene.id, locationId, elements: [] } }, ctx);
    const del = await lensRun("film-studios", "location-delete", { params: { id: locationId } }, ctx);
    assert.equal(del.ok, true);
    const get = await lensRun("film-studios", "scene-script-get", { params: { sceneId: scene.id } }, ctx);
    assert.equal(get.result.locationId, null); // delete unlinks referencing scenes
    const again = await lensRun("film-studios", "location-delete", { params: { id: locationId } }, ctx);
    assert.equal(again.error, "location not found");
    const upGhost = await lensRun("film-studios", "location-update", { params: { id: locationId, name: "X" } }, ctx);
    assert.equal(upGhost.error, "location not found");
  });

  it("task-update coerces status through the allowed list; task-delete refuses a repeat", async () => {
    const r = await lensRun("film-studios", "task-update", { params: { id: taskId, status: "doing" } }, ctx);
    assert.equal(r.result.task.status, "todo"); // invalid status keeps the current value
    const r2 = await lensRun("film-studios", "task-update", { params: { id: taskId, status: "in_progress", assignee: "Pat" } }, ctx);
    assert.equal(r2.result.task.status, "in_progress");
    assert.equal(r2.result.task.assignee, "Pat");
    const ghost = await lensRun("film-studios", "task-update", { params: { id: "ftk_nope", title: "X" } }, ctx);
    assert.equal(ghost.error, "task not found");
    const del = await lensRun("film-studios", "task-delete", { params: { id: taskId } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "task-delete", { params: { id: taskId } }, ctx);
    assert.equal(again.error, "task not found");
  });

  it("production-calendar buckets the month's shoot days and task deadlines by day", async () => {
    const t2 = await lensRun("film-studios", "task-create", { params: { projectId, title: "Insurance cert", dueDate: "2026-03-05" } }, ctx);
    assert.equal(t2.ok, true);
    const r = await lensRun("film-studios", "production-calendar", { params: { projectId, year: 2026, month: 3 } }, ctx);
    assert.equal(r.result.year, 2026);
    assert.equal(r.result.month, 3);
    const day5 = r.result.days["05"];
    assert.ok(Array.isArray(day5));
    assert.equal(day5.filter((i) => i.type === "shoot_day").length, 1);
    assert.equal(day5.filter((i) => i.type === "task").length, 1);
    assert.equal(day5.find((i) => i.type === "task").label, "Insurance cert");
    const april = await lensRun("film-studios", "production-calendar", { params: { projectId, year: 2026, month: 4 } }, ctx);
    assert.deepEqual(april.result.days, {}); // nothing scheduled in April
  });

  it("element-list-report dedupes elements case-insensitively across scenes", async () => {
    await lensRun("film-studios", "breakdown-tag", { params: { sceneId: scene.id, name: "Hero Car", category: "vehicles" } }, ctx);
    const scene2 = await seedScene(ctx, projectId, { location: "Depot" });
    await lensRun("film-studios", "breakdown-tag", { params: { sceneId: scene2.id, name: "hero car", category: "vehicles" } }, ctx);
    await lensRun("film-studios", "breakdown-tag", { params: { sceneId: scene2.id, name: "Wrench", category: "props" } }, ctx);
    const r = await lensRun("film-studios", "element-list-report", { params: { projectId } }, ctx);
    assert.equal(r.result.totalElements, 3);
    assert.equal(r.result.byCategory.vehicles.length, 1); // same element, two scenes
    assert.deepEqual(r.result.byCategory.vehicles[0].scenes.sort(), ["1", "2"]); // scene numbers
    assert.equal(r.result.byCategory.props.length, 1);
  });
});

describe("film-studios — revisions and page locks", () => {
  let ctx; let projectId; let revisionId;
  before(async () => {
    ctx = await depthCtx("q63-film-revisions");
    projectId = await seedProject(ctx);
    const rev = await lensRun("film-studios", "revision-create", { params: { projectId, label: "Blue pages" } }, ctx);
    revisionId = rev.result.revision.id;
    assert.equal(rev.result.revision.color, "white"); // first revision takes the first color
    assert.equal(rev.result.revision.ordinal, 1);
  });

  it("page-lock-toggle locks and unlocks pages on the revision", async () => {
    const on = await lensRun("film-studios", "page-lock-toggle", { params: { revisionId, page: "12" } }, ctx);
    assert.equal(on.ok, true);
    assert.equal(on.result.locked, true);
    assert.deepEqual(on.result.lockedPages, ["12"]);
    const on2 = await lensRun("film-studios", "page-lock-toggle", { params: { revisionId, page: "3" } }, ctx);
    assert.deepEqual(on2.result.lockedPages, ["12", "3"]); // handler sorts as strings
    const off = await lensRun("film-studios", "page-lock-toggle", { params: { revisionId, page: "12" } }, ctx);
    assert.equal(off.result.locked, false);
    assert.deepEqual(off.result.lockedPages, ["3"]);
    const noPage = await lensRun("film-studios", "page-lock-toggle", { params: { revisionId, page: "" } }, ctx);
    assert.equal(noPage.ok, false);
    assert.equal(noPage.error, "page required");
    const ghost = await lensRun("film-studios", "page-lock-toggle", { params: { revisionId: "rev_nope", page: "1" } }, ctx);
    assert.equal(ghost.error, "revision not found");
  });

  it("revision-delete removes the revision and refuses a repeat", async () => {
    const del = await lensRun("film-studios", "revision-delete", { params: { id: revisionId } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "revision-delete", { params: { id: revisionId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "revision not found");
  });
});

describe("film-studios — watch party and chat", () => {
  let ctx; let projectId; let partyId;
  before(async () => {
    ctx = await depthCtx("q63-film-party");
    projectId = await seedProject(ctx);
    const p = await lensRun("film-studios", "party-create", { params: { projectId, title: "Dailies watch" } }, ctx);
    assert.equal(p.ok, true);
    partyId = p.result.party.id;
    assert.match(p.result.party.code, /^FILM-\d{4}$/);
  });

  it("party-state reports the host as sole participant, paused at zero", async () => {
    const r = await lensRun("film-studios", "party-state", { params: { id: partyId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.party.playing, false);
    assert.equal(r.result.party.positionSec, 0);
    assert.equal(r.result.party.participantCount, 1);
    const ghost = await lensRun("film-studios", "party-state", { params: { id: "pty_nope" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "party not found");
  });

  it("party-sync moves the playhead and play state, read back exactly while paused", async () => {
    const r = await lensRun("film-studios", "party-sync", { params: { id: partyId, positionSec: 125.5, playing: false } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.positionSec, 125.5);
    assert.equal(r.result.playing, false);
    const state = await lensRun("film-studios", "party-state", { params: { id: partyId } }, ctx);
    assert.equal(state.result.party.positionSec, 125.5); // no drift while paused
    const neg = await lensRun("film-studios", "party-sync", { params: { id: partyId, positionSec: -4 } }, ctx);
    assert.equal(neg.result.positionSec, 0); // clamped at zero
  });

  it("party-chat-post appends messages and party-chat-list returns them in order", async () => {
    const empty = await lensRun("film-studios", "party-chat-post", { params: { id: partyId, text: "  " } }, ctx);
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "message text required");
    const m1 = await lensRun("film-studios", "party-chat-post", { params: { id: partyId, text: "That cut works", author: "Ana", atSec: 122.6 } }, ctx);
    assert.equal(m1.ok, true);
    assert.equal(m1.result.message.atSec, 123); // rounded to the second
    await lensRun("film-studios", "party-chat-post", { params: { id: partyId, text: "Agreed" } }, ctx);
    const list = await lensRun("film-studios", "party-chat-list", { params: { id: partyId } }, ctx);
    assert.equal(list.result.count, 2);
    assert.equal(list.result.messages[0].text, "That cut works");
    assert.equal(list.result.messages[1].author, "Guest"); // default author
    const ghost = await lensRun("film-studios", "party-chat-list", { params: { id: "pty_nope" } }, ctx);
    assert.equal(ghost.error, "party not found");
  });

  it("party-delete removes the party and its chat with it", async () => {
    const del = await lensRun("film-studios", "party-delete", { params: { id: partyId } }, ctx);
    assert.equal(del.ok, true);
    const chat = await lensRun("film-studios", "party-chat-list", { params: { id: partyId } }, ctx);
    assert.equal(chat.ok, false);
    assert.equal(chat.error, "party not found");
    const again = await lensRun("film-studios", "party-delete", { params: { id: partyId } }, ctx);
    assert.equal(again.error, "party not found");
  });
});

describe("film-studios — media and multicam", () => {
  let ctx; let projectId; let mediaA; let mediaB; let groupId;
  before(async () => {
    ctx = await depthCtx("q63-film-media");
    projectId = await seedProject(ctx);
    const a = await lensRun("film-studios", "media-register", { params: { projectId, name: "A-cam card 1", camera: "A" } }, ctx);
    mediaA = a.result.media.id;
    const b = await lensRun("film-studios", "media-register", { params: { projectId, name: "B-cam card 1", camera: "B", proxyUrl: "https://cdn.example/proxy/b1.mp4" } }, ctx);
    mediaB = b.result.media.id;
    assert.equal(b.result.media.quality, "proxy"); // a proxy URL implies proxy quality
  });

  it("media-list counts proxies among the project's media", async () => {
    const r = await lensRun("film-studios", "media-list", { params: { projectId } }, ctx);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.proxyCount, 1);
  });

  it("media-set-quality changes quality and keeps it on an invalid value", async () => {
    const r = await lensRun("film-studios", "media-set-quality", { params: { id: mediaA, quality: "offline" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.quality, "offline");
    const bad = await lensRun("film-studios", "media-set-quality", { params: { id: mediaA, quality: "ultra" } }, ctx);
    assert.equal(bad.result.quality, "offline"); // invalid pick falls back to current
    const ghost = await lensRun("film-studios", "media-set-quality", { params: { id: "mda_nope", quality: "full" } }, ctx);
    assert.equal(ghost.ok, false);
    assert.equal(ghost.error, "media not found");
  });

  it("multicam-list expands a group's angles from its member media", async () => {
    const g = await lensRun("film-studios", "multicam-group", { params: { projectId, name: "Interview setup", mediaIds: [mediaA, mediaB] } }, ctx);
    assert.equal(g.ok, true);
    groupId = g.result.group.id;
    assert.equal(g.result.group.angleCount, 2);
    const r = await lensRun("film-studios", "multicam-list", { params: { projectId } }, ctx);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.groups[0].angles.length, 2);
    assert.equal(r.result.groups[0].angles[0].mcamAngle, 1); // stamped in mediaIds order
    assert.equal(r.result.groups[0].angles[1].mcamAngle, 2);
    assert.equal(r.result.groups[0].angles[1].camera, "B");
  });

  it("multicam-delete detaches the group's media and refuses a repeat", async () => {
    const del = await lensRun("film-studios", "multicam-delete", { params: { id: groupId } }, ctx);
    assert.equal(del.ok, true);
    const media = await lensRun("film-studios", "media-list", { params: { projectId } }, ctx);
    assert.equal(media.result.media.find((m) => m.id === mediaA).mcamGroupId, null);
    const again = await lensRun("film-studios", "multicam-delete", { params: { id: groupId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "multicam group not found");
  });
});

describe("film-studios — festival tracker", () => {
  let ctx; let projectId; let subId;
  before(async () => {
    ctx = await depthCtx("q63-film-festivals");
    projectId = await seedProject(ctx);
    const s1 = await lensRun("film-studios", "festival-submit", { params: { projectId, festival: "Sundance", status: "submitted", fee: 85, deadline: "2026-08-01" } }, ctx);
    subId = s1.result.submission.id;
    await lensRun("film-studios", "festival-submit", { params: { projectId, festival: "Local Shorts Fest", status: "selected", fee: 40, deadline: "2026-05-15" } }, ctx);
    await lensRun("film-studios", "festival-submit", { params: { projectId, festival: "DocuWorld", fee: 0 } }, ctx);
  });

  it("festival-list sorts by deadline and aggregates status counts and fees", async () => {
    const r = await lensRun("film-studios", "festival-list", { params: { projectId } }, ctx);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.submissions[0].festival, "Local Shorts Fest"); // earliest deadline first
    assert.equal(r.result.submissions[2].festival, "DocuWorld"); // no deadline sorts last
    assert.equal(r.result.byStatus.submitted, 1);
    assert.equal(r.result.byStatus.selected, 1);
    assert.equal(r.result.byStatus.researching, 1); // default status
    assert.equal(r.result.totalFees, 125);
    assert.equal(r.result.selected, 1);
    assert.equal(r.result.pending, 1);
  });

  it("festival-update advances status and fee; festival-delete refuses a repeat", async () => {
    const up = await lensRun("film-studios", "festival-update", { params: { id: subId, status: "in_consideration", fee: 95 } }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.submission.status, "in_consideration");
    assert.equal(up.result.submission.fee, 95);
    const badStatus = await lensRun("film-studios", "festival-update", { params: { id: subId, status: "won_everything" } }, ctx);
    assert.equal(badStatus.result.submission.status, "in_consideration"); // invalid pick keeps current
    const ghost = await lensRun("film-studios", "festival-update", { params: { id: "fst_nope", fee: 1 } }, ctx);
    assert.equal(ghost.error, "submission not found");
    const del = await lensRun("film-studios", "festival-delete", { params: { id: subId } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("film-studios", "festival-delete", { params: { id: subId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "submission not found");
    const list = await lensRun("film-studios", "festival-list", { params: { projectId } }, ctx);
    assert.equal(list.result.totalFees, 40); // only the surviving submissions count
  });
});
