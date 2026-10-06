// tests/studio-keep.test.js — REAL end-to-end proof for the Studio lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real project via `project-create`, add a track via `track-add`,
// read it back via `project-get`, save it as a private DTU via
// `dtu.create`, read that DTU back via `dtu.get`, then draft it in Thread
// via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("studio project keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("studio-keep-proof"); });

  it("creates a real project, adds a track, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real project via the studio domain macro.
    const created = await lensRun("studio", "project-create", {
      params: { name: "Proof Track", bpm: 128 },
    }, ctx);
    assert.equal(created.ok, true, "project-create should succeed");
    const project = created.result.project;
    assert.ok(project.id, "project should have an id");
    assert.equal(project.name, "Proof Track");
    assert.equal(project.bpm, 128);

    // 2. Add a real track.
    const trackR = await lensRun("studio", "track-add", {
      params: { projectId: project.id, kind: "synth", name: "Lead" },
    }, ctx);
    assert.equal(trackR.ok, true, "track-add should succeed");
    const track = trackR.result.track;
    assert.ok(track.id, "track should have an id");
    assert.equal(track.name, "Lead");
    assert.equal(track.kind, "synth");

    // 3. Read the real project back (the same macro the UI uses).
    const got = await lensRun("studio", "project-get", { params: { id: project.id } }, ctx);
    assert.equal(got.ok, true, "project-get should succeed");
    const back = got.result.project;
    assert.equal(back.id, project.id);
    assert.equal(back.name, "Proof Track");
    assert.equal(back.bpm, 128);
    assert.ok(back.tracks.length >= 1, "project should have the track");
    assert.equal(back.tracks[0].name, "Lead");

    // 4. Save the project as a private DTU.
    const sentence = `${back.name}: ${back.bpm} bpm, ${back.timeSignature || "4/4"}, ${back.tracks.length} track${back.tracks.length === 1 ? "" : "s"}.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["studio", "daw", "music", "project"],
        source: "studio-lens:project-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "studio_lens_project_report",
          projectId: back.id,
          name: back.name,
          bpm: back.bpm,
          timeSignature: back.timeSignature,
          trackCount: back.tracks.length,
          createdAt: back.createdAt,
          updatedAt: back.updatedAt,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "studio" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Studio project — Proof Track",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create a project with no name", async () => {
    const r = await lensRun("studio", "project-create", { params: { name: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/name/.test(r.result.error), "should reject empty name");
  });
});