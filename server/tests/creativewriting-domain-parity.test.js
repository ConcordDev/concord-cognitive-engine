// Contract tests for the creative-writing Scrivener + Dabble + Plottr
// 2026-parity manuscript studio (projects, chapter/scene binder,
// corkboard, characters, plot threads, word-count goals).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCreativeWritingActions from "../domains/creativewriting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creative-writing.${name}`);
  assert.ok(fn, `creative-writing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCreativeWritingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newProject(ctx = ctxA) {
  const r = call("project-create", ctx, { title: "The Glass Tower", genre: "fantasy", targetWords: 80000 });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("creative-writing.project-*", () => {
  it("creates, lists with word count, updates and deletes with cascade", () => {
    const pid = newProject();
    const cid = call("chapter-add", ctxA, { projectId: pid, title: "Ch 1" }).result.chapter.id;
    const sid = call("scene-add", ctxA, { projectId: pid, chapterId: cid }).result.scene.id;
    call("scene-write", ctxA, { sceneId: sid, content: "one two three four five" });
    assert.equal(call("project-list", ctxA, {}).result.projects[0].wordCount, 5);
    call("project-update", ctxA, { id: pid, targetWords: 90000 });
    assert.equal(call("project-get", ctxA, { id: pid }).result.project.targetWords, 90000);
    call("project-delete", ctxA, { id: pid });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
  });

  it("isolates projects per user", () => {
    newProject(ctxA);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
  });
});

describe("creative-writing binder — chapters & scenes", () => {
  it("adds chapters and scenes and returns them in project-get", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid, title: "Opening" }).result.chapter.id;
    call("scene-add", ctxA, { projectId: pid, chapterId: c1, title: "Arrival" });
    call("scene-add", ctxA, { projectId: pid, chapterId: c1, title: "The Letter" });
    const tree = call("project-get", ctxA, { id: pid });
    assert.equal(tree.result.chapters.length, 1);
    assert.equal(tree.result.scenes.length, 2);
  });

  it("scene-write computes a word count", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid }).result.scene.id;
    const r = call("scene-write", ctxA, { sceneId: sid, content: "The rain fell hard that night" });
    assert.equal(r.result.wordCount, 6);
  });

  it("scene-move relocates a scene to another chapter", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid }).result.chapter.id;
    const c2 = call("chapter-add", ctxA, { projectId: pid }).result.chapter.id;
    const sid = call("scene-add", ctxA, { projectId: pid, chapterId: c1 }).result.scene.id;
    call("scene-move", ctxA, { sceneId: sid, chapterId: c2 });
    const moved = call("project-get", ctxA, { id: pid }).result.scenes.find((x) => x.id === sid);
    assert.equal(moved.chapterId, c2);
  });

  it("chapter-delete unfiles its scenes rather than dropping them", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid }).result.chapter.id;
    const sid = call("scene-add", ctxA, { projectId: pid, chapterId: c1 }).result.scene.id;
    call("chapter-delete", ctxA, { projectId: pid, chapterId: c1 });
    const scene = call("project-get", ctxA, { id: pid }).result.scenes.find((x) => x.id === sid);
    assert.equal(scene.chapterId, null);
  });

  it("reorders scenes within a chapter", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid }).result.chapter.id;
    const s1 = call("scene-add", ctxA, { projectId: pid, chapterId: c1 }).result.scene.id;
    const s2 = call("scene-add", ctxA, { projectId: pid, chapterId: c1 }).result.scene.id;
    const r = call("scene-reorder", ctxA, { sceneId: s2, direction: "up" });
    assert.deepEqual(r.result.order, [s2, s1]);
  });
});

describe("creative-writing.corkboard", () => {
  it("returns chapters with synopsis cards", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid, title: "Act I" }).result.chapter.id;
    call("scene-add", ctxA, { projectId: pid, chapterId: c1, title: "Inciting incident", synopsis: "The hero is called." });
    const board = call("corkboard", ctxA, { projectId: pid });
    assert.equal(board.result.chapters[0].cards.length, 1);
    assert.equal(board.result.chapters[0].cards[0].synopsis, "The hero is called.");
  });
});

describe("creative-writing characters & threads", () => {
  it("adds characters and assigns a scene POV", () => {
    const pid = newProject();
    const ch = call("character-add", ctxA, { projectId: pid, name: "Mira", role: "protagonist" }).result.character;
    const sid = call("scene-add", ctxA, { projectId: pid }).result.scene.id;
    call("scene-update", ctxA, { sceneId: sid, povCharacterId: ch.id });
    const scene = call("project-get", ctxA, { id: pid }).result.scenes.find((x) => x.id === sid);
    assert.equal(scene.povCharacterId, ch.id);
    assert.equal(call("character-list", ctxA, { projectId: pid }).result.count, 1);
  });

  it("creates plot threads and tags scenes to them", () => {
    const pid = newProject();
    const thread = call("thread-create", ctxA, { projectId: pid, name: "Romance arc" }).result.thread;
    const sid = call("scene-add", ctxA, { projectId: pid }).result.scene.id;
    call("scene-thread-tag", ctxA, { sceneId: sid, threadId: thread.id, attached: true });
    assert.equal(call("thread-list", ctxA, { projectId: pid }).result.threads[0].sceneCount, 1);
    call("scene-thread-tag", ctxA, { sceneId: sid, threadId: thread.id, attached: false });
    assert.equal(call("thread-list", ctxA, { projectId: pid }).result.threads[0].sceneCount, 0);
  });
});

describe("creative-writing word-count goals", () => {
  it("logs sessions and reports stats with target progress", () => {
    const pid = newProject();
    const c1 = call("chapter-add", ctxA, { projectId: pid }).result.chapter.id;
    const sid = call("scene-add", ctxA, { projectId: pid, chapterId: c1 }).result.scene.id;
    call("scene-write", ctxA, { sceneId: sid, content: Array(40).fill("word").join(" ") });
    call("session-log", ctxA, { projectId: pid, words: 1200, minutes: 45 });
    const stats = call("writing-stats", ctxA, { projectId: pid });
    assert.equal(stats.result.totalWords, 40);
    assert.equal(stats.result.sessionWords, 1200);
    assert.equal(stats.result.wordsToday, 1200);
    assert.equal(stats.result.streak, 1);
    assert.equal(stats.result.byChapter[0].words, 40);
  });

  it("rejects a session with no words", () => {
    const pid = newProject();
    assert.equal(call("session-log", ctxA, { projectId: pid, words: 0 }).ok, false);
  });

  it("dashboard reports scene status counts", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid }).result.scene.id;
    call("scene-update", ctxA, { sceneId: sid, status: "final" });
    const d = call("project-dashboard", ctxA, { projectId: pid });
    assert.equal(d.result.scenes, 1);
    assert.equal(d.result.byStatus.final, 1);
  });
});
