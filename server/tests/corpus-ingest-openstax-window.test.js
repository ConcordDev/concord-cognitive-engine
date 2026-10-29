// server/tests/corpus-ingest-openstax-window.test.js
//
// Q65/B#25: the OpenStax corpus pull used to fetch catalog page 1 and
// chapters 1-3 of every book on EVERY cycle — books 21+ and chapters 4+
// were unreachable forever. The first rotation fix advanced only when a
// whole page finished, but the default daily budget (25) is smaller than
// one window of one page (20 books x 3 chapters), so a page never
// finished and the rotation stalled on book ~9 of page 1. The cursor now
// records the exact book/chapter the budget stopped at and resumes there.
//
// Run: node --test server/tests/corpus-ingest-openstax-window.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  _advanceOpenStaxCursor, _pullOpenStax, _resetOpenStaxForTest, _refundOpenStaxBudgetForTest,
} from "../emergent/corpus-ingest.js";

const C0 = { offset: 0, chapterStart: 0, bookIdx: 0, chapterIdx: 0, pageMaxToc: 0 };

describe("_advanceOpenStaxCursor — pure step", () => {
  it("a budget stop keeps page + window and records book/chapter to resume at", () => {
    const n = _advanceOpenStaxCursor(C0, { booksOnPage: 20, stoppedAt: { bookIdx: 8, chapterIdx: 1 }, maxToc: 12 });
    assert.deepEqual(n, { offset: 0, chapterStart: 0, bookIdx: 8, chapterIdx: 1, pageMaxToc: 12 });
  });

  it("a finished window sweep advances the chapter window and restarts at book 0", () => {
    const n = _advanceOpenStaxCursor({ ...C0, bookIdx: 19, pageMaxToc: 12 }, { booksOnPage: 20, maxToc: 12 });
    assert.deepEqual(n, { offset: 0, chapterStart: 3, bookIdx: 0, chapterIdx: 0, pageMaxToc: 12 });
  });

  it("after the last window of the page it moves to the next catalog page", () => {
    const n = _advanceOpenStaxCursor({ ...C0, chapterStart: 9, pageMaxToc: 12 }, { booksOnPage: 20, maxToc: 12 });
    assert.deepEqual(n, { offset: 20, chapterStart: 0, bookIdx: 0, chapterIdx: 0, pageMaxToc: 0 });
  });

  it("wraps to offset 0 after a short final page", () => {
    const n = _advanceOpenStaxCursor({ ...C0, offset: 60, chapterStart: 9, pageMaxToc: 10 }, { booksOnPage: 7, maxToc: 10 });
    assert.equal(n.offset, 0);
    assert.equal(n.chapterStart, 0);
  });

  it("a page with no readable TOC is not retried forever", () => {
    const n = _advanceOpenStaxCursor(C0, { booksOnPage: 20, maxToc: 0 });
    assert.equal(n.offset, 20);
  });

  it("a failed catalog fetch leaves the cursor untouched", () => {
    const cur = { ...C0, bookIdx: 4, chapterIdx: 2, chapterStart: 3, pageMaxToc: 9 };
    assert.deepEqual(_advanceOpenStaxCursor(cur, { fetched: false }), cur);
  });
});

// ── Driven through the real _pullOpenStax with a fake catalog ─────────────
const N_BOOKS = 45;       // pages of 20 -> 20, 20, 5
const N_CHAPTERS = 7;     // windows of 3 -> 0-2, 3-5, 6
const realFetch = globalThis.fetch;

function installFakeOpenStax() {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname === "/api/v2/pages/") {
      const off = Number(u.searchParams.get("offset") || 0);
      const lim = Number(u.searchParams.get("limit") || 20);
      const items = [];
      for (let b = off; b < Math.min(off + lim, N_BOOKS); b++) items.push({ title: `Book ${b}`, slug: `book-${b}` });
      return json({ items });
    }
    const slug = u.searchParams.get("slug");
    const b = Number(slug.replace("book-", ""));
    return json({ items: [{ book_state: Array.from({ length: N_CHAPTERS }, (_, c) => ({ title: `ch${c}`, content: `text ${b}/${c}` })) }] });
  };
}

describe("_pullOpenStax rotation under the DEFAULT 25/day budget", () => {
  beforeEach(() => { _resetOpenStaxForTest(); installFakeOpenStax(); });
  afterEach(() => { globalThis.fetch = realFetch; _resetOpenStaxForTest(); });

  it("reaches every (book, chapter) pair exactly once per rotation, past book 20 and chapter 3", async () => {
    const seen = new Map();
    const bridge = async (ev) => { seen.set(ev.data.title, (seen.get(ev.data.title) || 0) + 1); };
    const total = N_BOOKS * N_CHAPTERS;
    let days = 0;
    while (seen.size < total && days < 40) {
      _refundOpenStaxBudgetForTest(); // a new day: full default budget
      const r = await _pullOpenStax(bridge);
      assert.ok(r.pulled <= 25, "never exceeds the daily budget");
      assert.ok(r.pulled > 0, `day ${days} made progress`);
      days++;
    }
    assert.equal(seen.size, total, `covered ${seen.size}/${total} chapters in ${days} days`);
    assert.ok(seen.has("Book 44 — ch6"), "last book, last chapter");
    assert.ok(seen.has("Book 20 — ch0"), "page 2 (books 21+) is reachable");
    for (const [t, n] of seen) assert.equal(n, 1, `${t} pulled ${n}x`);
    // One window sweep per cycle, so a sweep that finishes under budget ends
    // that cycle early; allow 2x the ideal, but not the old never-finishes.
    assert.ok(days <= 2 * Math.ceil(total / 25), `rotation took ${days} days`);
  });

  it("a budget stop inside a book resumes at that exact chapter next cycle", async () => {
    const order = [];
    const bridge = async (ev) => { order.push(ev.data.title); };
    _refundOpenStaxBudgetForTest();
    await _pullOpenStax(bridge);                 // 25 pulls = books 0-7 (24) + Book 8 ch0
    assert.equal(order.length, 25);
    assert.equal(order[24], "Book 8 — ch0");
    const day1 = order.length;
    _refundOpenStaxBudgetForTest();
    await _pullOpenStax(bridge);
    assert.equal(order[day1], "Book 8 — ch1", "resumes mid-book, no re-pull of ch0");
    assert.equal(new Set(order).size, order.length, "no chapter pulled twice");
  });
});
