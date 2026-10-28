// server/tests/corpus-ingest-openstax-window.test.js
//
// Q65/B#25: the OpenStax corpus pull used to fetch catalog page 1 and
// chapters 1-3 of every book on EVERY cycle — books 21+ and chapters 4+
// were unreachable forever while the daily budget kept being spent on
// the same slice. _nextOpenStaxWindow is the pure rotation step that
// fixes it; these tests pin its semantics.
//
// Run: node --test server/tests/corpus-ingest-openstax-window.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _nextOpenStaxWindow } from "../emergent/corpus-ingest.js";

describe("_nextOpenStaxWindow — OpenStax ingest rotation (Q65)", () => {
  it("advances the chapter window by 3 each cycle", () => {
    const n = _nextOpenStaxWindow({ offset: 0, chapterStart: 0 }, { booksOnPage: 20, pageCompleted: false, maxToc: 12 });
    assert.equal(n.chapterStart, 3);
  });

  it("wraps the chapter window to 0 once it passes the longest TOC", () => {
    const n = _nextOpenStaxWindow({ offset: 0, chapterStart: 9 }, { booksOnPage: 20, pageCompleted: false, maxToc: 12 });
    assert.equal(n.chapterStart, 0); // 9 + 3 >= 12 -> wrap
  });

  it("keeps the chapter window when no TOC was read (fetch failed)", () => {
    const n = _nextOpenStaxWindow({ offset: 0, chapterStart: 6 }, { booksOnPage: 0, pageCompleted: false, maxToc: 0 });
    assert.equal(n.chapterStart, 6);
  });

  it("advances the catalog offset only when the page was fully consumed", () => {
    const done = _nextOpenStaxWindow({ offset: 0, chapterStart: 0 }, { booksOnPage: 20, pageCompleted: true, maxToc: 10 });
    assert.equal(done.offset, 20);
    const broke = _nextOpenStaxWindow({ offset: 0, chapterStart: 0 }, { booksOnPage: 20, pageCompleted: false, maxToc: 10 });
    assert.equal(broke.offset, 0); // budget broke mid-page: retry this page (with later chapters)
  });

  it("wraps the catalog offset to 0 after a short final page", () => {
    const n = _nextOpenStaxWindow({ offset: 60, chapterStart: 0 }, { booksOnPage: 7, pageCompleted: true, maxToc: 10 });
    assert.equal(n.offset, 0);
  });

  it("a full rotation reaches chapters and books the old fixed window never could", () => {
    // Simulate cycles over a 45-book catalog (pages of 20) with 12-chapter
    // books: assert the window pair (offset, chapterStart) keeps moving and
    // eventually covers offset 40 (book 41+) and chapterStart 9 (chapters 10-12).
    let cursor = { offset: 0, chapterStart: 0 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      seen.add(`${cursor.offset}:${cursor.chapterStart}`);
      const booksOnPage = cursor.offset >= 40 ? 5 : 20;
      cursor = _nextOpenStaxWindow(cursor, { booksOnPage, pageCompleted: true, maxToc: 12 });
    }
    assert.ok(seen.has("40:0") || seen.has("40:3") || seen.has("40:6") || seen.has("40:9"), "rotation reaches the third catalog page");
    assert.ok([...seen].some((k) => k.endsWith(":9")), "rotation reaches the last chapter window");
  });
});
