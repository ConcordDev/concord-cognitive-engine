// Contract tests for the poetry lens — poem workspace substrate in
// server/domains/poetry.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPoetryActions from "../domains/poetry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`poetry.${name}`);
  assert.ok(fn, `poetry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPoetryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const HAIKU = "An old silent pond\nA frog jumps into the pond\nSplash silence again";

describe("poetry.poem CRUD", () => {
  it("creates a poem scoped per user", () => {
    call("poem-create", ctxA, { title: "Pond", body: HAIKU, form: "haiku" });
    assert.equal(call("poem-list", ctxA, {}).result.count, 1);
    assert.equal(call("poem-list", ctxB, {}).result.count, 0);
  });
  it("rejects a titleless poem", () => {
    assert.equal(call("poem-create", ctxA, { body: "x" }).ok, false);
  });
  it("updates body + status and deletes", () => {
    const p = call("poem-create", ctxA, { title: "Draft", body: "one line" }).result.poem;
    call("poem-update", ctxA, { id: p.id, status: "finished", body: HAIKU });
    assert.equal(call("poem-detail", ctxA, { id: p.id }).result.poem.status, "finished");
    call("poem-delete", ctxA, { id: p.id });
    assert.equal(call("poem-list", ctxA, {}).result.count, 0);
  });
  it("filters poem-list by form", () => {
    call("poem-create", ctxA, { title: "H", body: HAIKU, form: "haiku" });
    call("poem-create", ctxA, { title: "S", body: "sonnet text", form: "sonnet" });
    assert.equal(call("poem-list", ctxA, { form: "haiku" }).result.count, 1);
  });
});

describe("poetry.poem-analyze", () => {
  it("analyzes meter + rhyme on a saved poem", () => {
    const p = call("poem-create", ctxA, { title: "Pond", body: HAIKU }).result.poem;
    const a = call("poem-analyze", ctxA, { id: p.id });
    assert.equal(a.ok, true);
    assert.equal(a.result.analysis.lineCount, 3);
    assert.equal(a.result.analysis.syllablesPerLine.length, 3);
    assert.ok(typeof a.result.analysis.rhymeScheme === "string");
  });
  it("rejects analysis on an unknown poem", () => {
    assert.equal(call("poem-analyze", ctxA, { id: "nope" }).ok, false);
  });
});

describe("poetry.dashboard", () => {
  it("aggregates poems, status counts and forms", () => {
    const p = call("poem-create", ctxA, { title: "A", body: HAIKU, form: "haiku" }).result.poem;
    call("poem-update", ctxA, { id: p.id, status: "finished" });
    call("poem-create", ctxA, { title: "B", body: "free text", form: "free-verse" });
    const d = call("poetry-dashboard", ctxA, {});
    assert.equal(d.result.poems, 2);
    assert.equal(d.result.finished, 1);
    assert.equal(d.result.byForm.haiku, 1);
  });
});

describe("poetry — analysis macros still intact", () => {
  it("formGuide returns a form guide", () => {
    const r = call("formGuide", ctxA, {});
    assert.equal(r.ok, true);
  });
});

/* ── Backlog: form templates + live constraint checking ─────────────── */

describe("poetry.form-rules / form-check", () => {
  it("form-rules returns a constraint spec for haiku", () => {
    const r = call("form-rules", ctxA, { form: "haiku" });
    assert.equal(r.ok, true);
    assert.equal(r.result.form, "haiku");
    assert.deepEqual(r.result.rules.syllablesPerLine, [5, 7, 5]);
  });
  it("form-rules falls back to free-verse for an unknown form", () => {
    const r = call("form-rules", ctxA, { form: "nonsense" });
    assert.equal(r.result.form, "nonsense");
    assert.equal(r.result.rules.lineCount, null);
  });
  it("form-check validates a correct haiku as valid", () => {
    const r = call("form-check", ctxA, { form: "haiku", body: HAIKU });
    assert.equal(r.ok, true);
    assert.equal(r.result.lineCount, 3);
    assert.equal(r.result.lineReports.length, 3);
  });
  it("form-check flags a line-count violation", () => {
    const r = call("form-check", ctxA, { form: "haiku", body: "only one line here" });
    assert.equal(r.result.valid, false);
    assert.ok(r.result.violations.some((v) => /lines/.test(v)));
  });
});

/* ── Backlog: inline rhyme + word suggestion (Datamuse) ─────────────── */

describe("poetry.word-suggest", () => {
  beforeEach(() => {
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => {
        assert.match(String(url), /api\.datamuse\.com/);
        return [
          { word: "moon", score: 900, numSyllables: 1 },
          { word: "tune", score: 800, numSyllables: 1 },
        ];
      },
    });
  });
  it("rejects an empty word", async () => {
    const r = await call("word-suggest", ctxA, { word: "" });
    assert.equal(r.ok, false);
  });
  it("returns rhymes for a real word", async () => {
    const r = await call("word-suggest", ctxA, { word: "june", kind: "rhyme" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.words[0].word, "moon");
    assert.equal(r.result.source, "datamuse");
  });
  it("surfaces datamuse failures", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    // Distinct word so the TTL cache from prior tests is not hit.
    const r = await call("word-suggest", ctxA, { word: "starlight" });
    assert.equal(r.ok, false);
  });
});

/* ── Backlog: poem-a-day / curated discovery feed ───────────────────── */

describe("poetry.discovery-themes / poem-of-the-day / themed-collection", () => {
  it("discovery-themes lists curated themed collections", () => {
    const r = call("discovery-themes", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(r.result.themes.every((t) => t.id && t.label));
  });
  it("poem-of-the-day is deterministic per calendar date", async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (/\/author$/.test(u)) {
        return { ok: true, json: async () => ({ authors: ["Emily Dickinson", "Robert Frost"] }) };
      }
      return {
        ok: true,
        json: async () => ([
          { title: "Hope", author: "Emily Dickinson", lines: ["Hope is the thing"], linecount: "1" },
          { title: "Bird", author: "Emily Dickinson", lines: ["A bird came down"], linecount: "1" },
        ]),
      };
    };
    const a = await call("poem-of-the-day", ctxA, { date: "2026-05-21" });
    const b = await call("poem-of-the-day", ctxB, { date: "2026-05-21" });
    assert.equal(a.ok, true);
    assert.equal(a.result.poem.title, b.result.poem.title);
    assert.equal(a.result.date, "2026-05-21");
  });
  it("themed-collection fetches live poems for a known theme", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([
        { title: "Sonnet 43", author: "Elizabeth Barrett Browning", lines: ["How do I love thee"], linecount: "1" },
      ]),
    });
    const r = await call("themed-collection", ctxA, { themeId: "love-and-longing", perAuthor: 1 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.equal(r.result.themeId, "love-and-longing");
  });
  it("themed-collection rejects an unknown theme", async () => {
    const r = await call("themed-collection", ctxA, { themeId: "no-such-theme" });
    assert.equal(r.ok, false);
  });
});

/* ── Backlog: reading history + favorites ───────────────────────────── */

describe("poetry.favorite-* / reading-history", () => {
  it("adds, lists and removes a favorite", () => {
    const add = call("favorite-add", ctxA, { title: "Hope", author: "Emily Dickinson", lines: ["Hope is the thing"] });
    assert.equal(add.ok, true);
    assert.equal(call("favorite-list", ctxA, {}).result.count, 1);
    assert.equal(call("favorite-list", ctxB, {}).result.count, 0);
    const rm = call("favorite-remove", ctxA, { id: add.result.favorite.id });
    assert.equal(rm.ok, true);
    assert.equal(call("favorite-list", ctxA, {}).result.count, 0);
  });
  it("de-duplicates the same poem", () => {
    call("favorite-add", ctxA, { title: "Hope", author: "Emily Dickinson" });
    const dup = call("favorite-add", ctxA, { title: "Hope", author: "Emily Dickinson" });
    assert.equal(dup.result.already, true);
    assert.equal(call("favorite-list", ctxA, {}).result.count, 1);
  });
  it("logs reads and increments readCount", () => {
    call("reading-log", ctxA, { title: "Bird", author: "Emily Dickinson" });
    call("reading-log", ctxA, { title: "Bird", author: "Emily Dickinson" });
    const h = call("reading-history", ctxA, {});
    assert.equal(h.result.count, 1);
    assert.equal(h.result.history[0].readCount, 2);
  });
});

/* ── Backlog: audio recordings ──────────────────────────────────────── */

describe("poetry.recording-*", () => {
  const DATA_URL = "data:audio/webm;base64,AAAA";
  it("saves a recording against a real poem and plays it back", () => {
    const p = call("poem-create", ctxA, { title: "Pond", body: HAIKU }).result.poem;
    const rec = call("recording-save", ctxA, { poemId: p.id, audioDataUrl: DATA_URL, durationSec: 12 });
    assert.equal(rec.ok, true);
    const list = call("recording-list", ctxA, { poemId: p.id });
    assert.equal(list.result.count, 1);
    const got = call("recording-get", ctxA, { id: rec.result.recording.id });
    assert.equal(got.result.recording.audioDataUrl, DATA_URL);
  });
  it("rejects a recording for an unknown poem", () => {
    const r = call("recording-save", ctxA, { poemId: "nope", audioDataUrl: DATA_URL });
    assert.equal(r.ok, false);
  });
  it("rejects a non-data-URL payload", () => {
    const p = call("poem-create", ctxA, { title: "P", body: HAIKU }).result.poem;
    const r = call("recording-save", ctxA, { poemId: p.id, audioDataUrl: "http://x" });
    assert.equal(r.ok, false);
  });
  it("deletes a recording", () => {
    const p = call("poem-create", ctxA, { title: "P", body: HAIKU }).result.poem;
    const rec = call("recording-save", ctxA, { poemId: p.id, audioDataUrl: DATA_URL });
    call("recording-delete", ctxA, { id: rec.result.recording.id });
    assert.equal(call("recording-list", ctxA, {}).result.count, 0);
  });
});

/* ── Backlog: workshop / peer feedback ──────────────────────────────── */

describe("poetry.workshop-*", () => {
  it("shares a poem and another user critiques a line", () => {
    const p = call("poem-create", ctxA, { title: "Pond", body: HAIKU }).result.poem;
    const share = call("workshop-share", ctxA, { poemId: p.id, authorName: "A" });
    assert.equal(share.ok, true);
    assert.equal(call("workshop-list", ctxB, {}).result.count, 1);
    const crit = call("workshop-critique", ctxB, {
      id: share.result.share.id, lineIndex: 1, comment: "Lovely image here", kind: "praise", criticName: "B",
    });
    assert.equal(crit.ok, true);
    const detail = call("workshop-detail", ctxB, { id: share.result.share.id });
    assert.equal(detail.result.share.critiques.length, 1);
    assert.equal(detail.result.share.critiques[0].lineIndex, 1);
  });
  it("rejects a critique without a comment", () => {
    const p = call("poem-create", ctxA, { title: "P", body: HAIKU }).result.poem;
    const share = call("workshop-share", ctxA, { poemId: p.id });
    const r = call("workshop-critique", ctxB, { id: share.result.share.id, lineIndex: 0, comment: "" });
    assert.equal(r.ok, false);
  });
  it("only the owner can unshare", () => {
    const p = call("poem-create", ctxA, { title: "P", body: HAIKU }).result.poem;
    const share = call("workshop-share", ctxA, { poemId: p.id });
    assert.equal(call("workshop-unshare", ctxB, { id: share.result.share.id }).ok, false);
    assert.equal(call("workshop-unshare", ctxA, { id: share.result.share.id }).ok, true);
  });
});

/* ── Backlog: recording list filtering + word-suggest near-rhyme ────── */

describe("poetry.recording-list filtering", () => {
  const DATA_URL = "data:audio/webm;base64,BBBB";
  it("filters recordings to a single poem and omits the audio payload", () => {
    const p1 = call("poem-create", ctxA, { title: "One", body: HAIKU }).result.poem;
    const p2 = call("poem-create", ctxA, { title: "Two", body: HAIKU }).result.poem;
    call("recording-save", ctxA, { poemId: p1.id, audioDataUrl: DATA_URL });
    call("recording-save", ctxA, { poemId: p2.id, audioDataUrl: DATA_URL });
    const all = call("recording-list", ctxA, {});
    assert.equal(all.result.count, 2);
    const justOne = call("recording-list", ctxA, { poemId: p1.id });
    assert.equal(justOne.result.count, 1);
    assert.equal(justOne.result.recordings[0].audioDataUrl, undefined);
  });
});

describe("poetry.word-suggest near-rhyme kind", () => {
  it("requests a near-rhyme relation when kind is 'near'", async () => {
    let seenUrl = "";
    globalThis.fetch = async (url) => {
      seenUrl = String(url);
      return { ok: true, json: async () => ([{ word: "soon", score: 700, numSyllables: 1 }]) };
    };
    const r = await call("word-suggest", ctxA, { word: "noon", kind: "near" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "near");
    assert.match(seenUrl, /rel_nry=/);
  });
});

/* ── Backlog: chapbook export ───────────────────────────────────────── */

describe("poetry.chapbook-export", () => {
  it("assembles selected poems into a print-ready chapbook", () => {
    const p1 = call("poem-create", ctxA, { title: "First", body: HAIKU }).result.poem;
    const p2 = call("poem-create", ctxA, { title: "Second", body: "two\nlines" }).result.poem;
    const r = call("chapbook-export", ctxA, { title: "My Book", author: "A", poemIds: [p1.id, p2.id] });
    assert.equal(r.ok, true);
    assert.equal(r.result.chapbook.poemCount, 2);
    assert.match(r.result.html, /<!DOCTYPE html>/);
    assert.match(r.result.html, /My Book/);
    assert.match(r.result.filename, /\.html$/);
  });
  it("defaults to finished poems when no ids are given", () => {
    const p = call("poem-create", ctxA, { title: "Done", body: HAIKU }).result.poem;
    call("poem-update", ctxA, { id: p.id, status: "finished" });
    call("poem-create", ctxA, { title: "Draft", body: "x" });
    const r = call("chapbook-export", ctxA, { title: "Book" });
    assert.equal(r.result.chapbook.poemCount, 1);
  });
  it("rejects an empty chapbook", () => {
    const r = call("chapbook-export", ctxA, { title: "Empty", poemIds: ["nope"] });
    assert.equal(r.ok, false);
  });
});
