// Tier-2 contract tests for creative-writing lens feature-parity macros
// (draggable corkboard / format compile / per-doc targets / setting bible /
//  snapshot diff / manuscript statistics). Pins per-user scoping, format
// correctness, and the diff/stats math.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCreativeWritingActions from "../domains/creativewriting.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creative-writing.${name}`);
  if (!fn) throw new Error(`creative-writing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCreativeWritingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Helper — bootstrap a project with one chapter + scene with prose.
function seedProject(ctx) {
  const proj = call("project-create", ctx, { title: "Test Novel", targetWords: 1000 }).result.project;
  const chap = call("chapter-add", ctx, { projectId: proj.id, title: "Chapter One" }).result.chapter;
  const scene = call("scene-add", ctx, { projectId: proj.id, chapterId: chap.id, title: "Opening" }).result.scene;
  return { proj, chap, scene };
}

describe("creative-writing — scene-set-order (draggable corkboard)", () => {
  it("renumbers scenes to the explicit dropped order", () => {
    const { proj, chap, scene } = seedProject(ctxA);
    const s1 = call("scene-add", ctxA, { projectId: proj.id, chapterId: chap.id, title: "S1" }).result.scene;
    const s2 = call("scene-add", ctxA, { projectId: proj.id, chapterId: chap.id, title: "S2" }).result.scene;
    const s3 = call("scene-add", ctxA, { projectId: proj.id, chapterId: chap.id, title: "S3" }).result.scene;
    const r = call("scene-set-order", ctxA, {
      projectId: proj.id, chapterId: chap.id, sceneIds: [s3.id, s1.id, s2.id, scene.id],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.order, [s3.id, s1.id, s2.id, scene.id]);
    const board = call("corkboard", ctxA, { projectId: proj.id }).result;
    const chapterCards = board.chapters.find((c) => c.id === chap.id).cards;
    assert.deepEqual(chapterCards.map((c) => c.id), [s3.id, s1.id, s2.id, scene.id]);
  });

  it("can drop a scene into a different chapter", () => {
    const { proj, chap, scene } = seedProject(ctxA);
    const chap2 = call("chapter-add", ctxA, { projectId: proj.id, title: "Chapter Two" }).result.chapter;
    const r = call("scene-set-order", ctxA, {
      projectId: proj.id, chapterId: chap2.id, sceneIds: [scene.id],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.chapterId, chap2.id);
    void chap;
  });

  it("rejects empty sceneIds and missing project", () => {
    const { proj } = seedProject(ctxA);
    assert.equal(call("scene-set-order", ctxA, { projectId: proj.id, sceneIds: [] }).ok, false);
    assert.equal(call("scene-set-order", ctxA, { projectId: "nope", sceneIds: ["x"] }).ok, false);
  });
});

describe("creative-writing — compile-export (format presets)", () => {
  it("compiles to markdown with chapter headings", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "It was a dark night." });
    const r = call("compile-export", ctxA, { projectId: proj.id, format: "markdown" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.equal(r.result.extension, "md");
    assert.match(r.result.body, /# Test Novel/);
    assert.match(r.result.body, /## Chapter 1: Chapter One/);
    assert.match(r.result.body, /It was a dark night\./);
    assert.equal(r.result.wordCount, 5);
  });

  it("compiles to escaped HTML and EPUB XHTML", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "A <tag> & \"quote\"." });
    const html = call("compile-export", ctxA, { projectId: proj.id, format: "html" });
    assert.equal(html.result.mime, "text/html");
    assert.match(html.result.body, /&lt;tag&gt;/);
    assert.match(html.result.body, /&amp;/);
    const epub = call("compile-export", ctxA, { projectId: proj.id, format: "epub" });
    assert.equal(epub.result.extension, "xhtml");
    assert.match(epub.result.body, /^<\?xml/);
  });

  it("honors the includeDrafts flag (excludes outline scenes)", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "Draft text here." });
    // scene defaults to "outline" status
    const excluded = call("compile-export", ctxA, { projectId: proj.id, includeDrafts: false });
    assert.equal(excluded.result.wordCount, 0);
    call("scene-update", ctxA, { sceneId: scene.id, status: "final" });
    const included = call("compile-export", ctxA, { projectId: proj.id, includeDrafts: false });
    assert.equal(included.result.wordCount, 3);
  });
});

describe("creative-writing — per-document targets", () => {
  it("sets a scene target and rolls it into target-progress", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "one two three four five" });
    const set = call("scene-set-target", ctxA, { sceneId: scene.id, targetWords: 10 });
    assert.equal(set.ok, true);
    assert.equal(set.result.targetWords, 10);
    const prog = call("target-progress", ctxA, { projectId: proj.id });
    assert.equal(prog.ok, true);
    const doc = prog.result.documents.find((d) => d.sceneId === scene.id);
    assert.equal(doc.wordCount, 5);
    assert.equal(doc.targetWords, 10);
    assert.equal(doc.progressPct, 50);
    assert.equal(doc.met, false);
    assert.equal(prog.result.projectProgressPct, 1); // 5 / 1000
  });

  it("marks a target met once word count reaches it", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-set-target", ctxA, { sceneId: scene.id, targetWords: 3 });
    call("scene-write", ctxA, { sceneId: scene.id, content: "alpha beta gamma delta" });
    const prog = call("target-progress", ctxA, { projectId: proj.id });
    assert.equal(prog.result.docsMet, 1);
    assert.equal(prog.result.documents.find((d) => d.sceneId === scene.id).met, true);
  });
});

describe("creative-writing — setting bible (scene-linked notes)", () => {
  it("links a location note into a scene and surfaces it in the bible", () => {
    const { proj, scene } = seedProject(ctxA);
    const note = call("note-create", ctxA, {
      projectId: proj.id, title: "The Citadel", kind: "location", body: "A stone fortress.",
    }).result.note;
    const link = call("note-link-scene", ctxA, { noteId: note.id, sceneId: scene.id });
    assert.equal(link.ok, true);
    assert.deepEqual(link.result.linkedSceneIds, [scene.id]);
    const bible = call("setting-bible", ctxA, { projectId: proj.id });
    assert.equal(bible.ok, true);
    const entry = bible.result.entries.find((e) => e.id === note.id);
    assert.equal(entry.linkedCount, 1);
    assert.equal(entry.linkedScenes[0].title, "Opening");
  });

  it("unlinks a note and excludes non-setting note kinds", () => {
    const { proj, scene } = seedProject(ctxA);
    const loc = call("note-create", ctxA, { projectId: proj.id, title: "Town", kind: "location" }).result.note;
    call("note-create", ctxA, { projectId: proj.id, title: "Source", kind: "research" });
    call("note-link-scene", ctxA, { noteId: loc.id, sceneId: scene.id });
    const bible = call("setting-bible", ctxA, { projectId: proj.id });
    assert.equal(bible.result.count, 1); // research note excluded
    const unlink = call("note-link-scene", ctxA, { noteId: loc.id, sceneId: scene.id, linked: false });
    assert.deepEqual(unlink.result.linkedSceneIds, []);
  });

  it("rejects linking a note and scene across projects", () => {
    const a = seedProject(ctxA);
    const b = seedProject(ctxA);
    const note = call("note-create", ctxA, { projectId: a.proj.id, title: "X", kind: "lore" }).result.note;
    const r = call("note-link-scene", ctxA, { noteId: note.id, sceneId: b.scene.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /different projects/);
  });
});

describe("creative-writing — snapshot diff", () => {
  it("diffs a snapshot against the live draft", () => {
    const { scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "line one\nline two\nline three" });
    const snap = call("snapshot-take", ctxA, { sceneId: scene.id }).result.snapshot;
    call("scene-write", ctxA, { sceneId: scene.id, content: "line one\nline TWO edited\nline three\nline four" });
    const r = call("snapshot-diff", ctxA, { fromId: snap.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.toLabel, "Current draft");
    assert.equal(r.result.addedLines, 2); // "line TWO edited" + "line four"
    assert.equal(r.result.removedLines, 1); // "line two"
    assert.equal(r.result.unchangedLines, 2); // "line one" + "line three"
    assert.ok(r.result.wordDelta > 0);
  });

  it("diffs two snapshots of the same scene", () => {
    const { scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "first version" });
    const s1 = call("snapshot-take", ctxA, { sceneId: scene.id }).result.snapshot;
    call("scene-write", ctxA, { sceneId: scene.id, content: "second version expanded" });
    const s2 = call("snapshot-take", ctxA, { sceneId: scene.id }).result.snapshot;
    const r = call("snapshot-diff", ctxA, { fromId: s1.id, toId: s2.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.fromLabel, s1.title);
    assert.equal(r.result.toLabel, s2.title);
  });

  it("rejects an unknown snapshot id", () => {
    seedProject(ctxA);
    assert.equal(call("snapshot-diff", ctxA, { fromId: "nope" }).ok, false);
  });
});

describe("creative-writing — manuscript statistics", () => {
  it("computes dialogue ratio, word frequency, and pacing", () => {
    const { proj, scene } = seedProject(ctxA);
    call("scene-write", ctxA, {
      sceneId: scene.id,
      content: 'The wolf ran. "Hello there," said the wolf. The wolf howled quickly and loudly.',
    });
    const r = call("manuscript-stats", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, true);
    assert.ok(r.result.wordCount > 0);
    assert.ok(r.result.dialoguePct > 0);
    assert.equal(r.result.dialoguePct + r.result.prosePct, 100);
    // "wolf" appears 3 times — should top the frequency list, stopwords filtered.
    assert.equal(r.result.topWords[0].word, "wolf");
    assert.equal(r.result.topWords[0].count, 3);
    assert.ok(r.result.adverbCount >= 2); // quickly, loudly
    assert.equal(r.result.pacing.length, 1);
    assert.ok(["fast", "moderate", "slow"].includes(r.result.pacing[0].tempo));
  });

  it("returns hasData:false when no prose exists", () => {
    const { proj } = seedProject(ctxA);
    const r = call("manuscript-stats", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
  });

  it("can scope statistics to a single scene", () => {
    const { proj, chap, scene } = seedProject(ctxA);
    call("scene-write", ctxA, { sceneId: scene.id, content: "alpha beta gamma" });
    const other = call("scene-add", ctxA, { projectId: proj.id, chapterId: chap.id, title: "Two" }).result.scene;
    call("scene-write", ctxA, { sceneId: other.id, content: "delta epsilon zeta eta theta" });
    const single = call("manuscript-stats", ctxA, { projectId: proj.id, sceneId: scene.id });
    assert.equal(single.result.wordCount, 3);
    const whole = call("manuscript-stats", ctxA, { projectId: proj.id });
    assert.equal(whole.result.wordCount, 8);
  });
});

describe("creative-writing — per-user scoping + STATE guard", () => {
  it("INVARIANT: feature macros are scoped per-user", () => {
    const { proj } = seedProject(ctxA);
    // user B cannot see user A's project
    assert.equal(call("compile-export", ctxB, { projectId: proj.id }).ok, false);
    assert.equal(call("target-progress", ctxB, { projectId: proj.id }).ok, false);
    assert.equal(call("setting-bible", ctxB, { projectId: proj.id }).ok, false);
    assert.equal(call("manuscript-stats", ctxB, { projectId: proj.id }).ok, false);
  });

  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("compile-export", ctxA, { projectId: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
