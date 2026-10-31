import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S9 (F12b) — the daily note must be titled by the USER'S LOCAL date.
// The review caught "Daily — 2026-10-29" on the evening of Oct 28 EDT:
// the server fallback (todayIso) is a UTC date, and the frontend's
// DailyTab called daily-note with NO date, so the UTC fallback always
// won. The macro has always accepted an explicit `date` param — the
// S9 fix is the frontend sending the browser's local date. These tests
// pin the server contract that fix stands on:
//  (a) an explicit date files the note under THAT date, title included;
//  (b) the same date again returns the same note (created:false) —
//      the per-date keying the Daily tab's auto-create relies on;
//  (c) a different explicit date files a separate note;
//  (d) daily notes are per-user;
//  (e) with no date supplied the macro still answers (UTC fallback —
//      shape pinned, value deliberately not: it is timezone-dependent
//      by definition, which is the defect the FE fix routes around).

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("research — daily note local date (S9)", () => {
  it("files the daily note under an explicit local date, title included", () => {
    const r = call("daily-note", ctxA, { date: "2026-10-28" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.created, true);
    assert.equal(r.result.note.title, "Daily — 2026-10-28");
    assert.match(r.result.note.body, /# 2026-10-28/);
  });

  it("returns the same note for the same date (created:false)", () => {
    const first = call("daily-note", ctxA, { date: "2026-10-28" });
    const second = call("daily-note", ctxA, { date: "2026-10-28" });
    assert.equal(second.ok, true);
    assert.equal(second.result.created, false);
    assert.equal(second.result.note.id, first.result.note.id);
  });

  it("files a separate note for a different date", () => {
    const a = call("daily-note", ctxA, { date: "2026-10-28" });
    const b = call("daily-note", ctxA, { date: "2026-10-29" });
    assert.equal(b.result.created, true);
    assert.notEqual(b.result.note.id, a.result.note.id);
    assert.equal(b.result.note.title, "Daily — 2026-10-29");
  });

  it("keeps daily notes per-user for the same date", () => {
    const a = call("daily-note", ctxA, { date: "2026-10-28" });
    const b = call("daily-note", ctxB, { date: "2026-10-28" });
    assert.equal(b.result.created, true);
    assert.notEqual(b.result.note.id, a.result.note.id);
  });

  it("still answers with no date supplied (fallback shape)", () => {
    const r = call("daily-note", ctxA, {});
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.result.note.title, /^Daily — \d{4}-\d{2}-\d{2}$/);
  });
});
