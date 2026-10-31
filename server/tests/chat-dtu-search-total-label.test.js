// server/tests/chat-dtu-search-total-label.test.js
//
// A19 successor pin (Review 4 Addendum 7, sanctioned (a) of the
// (a)+(b) build): the dtu_search tool total must label itself, in the
// result the model reads, as corpus search hits sliced to the limit —
// never as an owned total. The failure being pinned: the analyst
// answered "You have 8 DTUs" from this total, where 8 was the search's
// default limit and the account's grounded Total DTUs fact was 1.

import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchChatDtuSearch } from "../lib/chat-tool-surface.js";

function row(i) {
  return { id: `dtu-hit-${i}`, title: `Hit ${i}`, source: "seed" };
}

function stubRunMacro(rows) {
  return async (domain, name, _input, _ctx) => {
    assert.equal(domain, "dtu");
    assert.equal(name, "search");
    return { ok: true, dtus: rows };
  };
}

test("the total reaching the model is labelled as search hits, not an owned total", async () => {
  const res = await dispatchChatDtuSearch(stubRunMacro([row(1), row(2), row(3)]), {}, { query: "notes" });
  assert.equal(res.ok, true);
  assert.equal(res.total, 3);
  assert.equal(res.totalKind, "search_hits");
  assert.match(res.note, /counts search hits across the searchable corpus/);
  assert.match(res.note, /NOT the user's owned DTU total/);
  assert.match(res.note, /never quote it as how many DTUs the user has/);
});

test("the cap itself is labelled: more hits than the default limit still read as search hits", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
  const res = await dispatchChatDtuSearch(stubRunMacro(rows), {}, { query: "notes" });
  // The A19 number: total is the default-limit slice (8), not a corpus
  // census and not an inventory — and it says so in the same result.
  assert.equal(res.total, 8);
  assert.equal(res.totalKind, "search_hits");
  assert.match(res.note, /sliced to the result limit/);
});

test("the empty result carries the label too", async () => {
  const res = await dispatchChatDtuSearch(stubRunMacro([]), {}, { query: "zzzz" });
  assert.equal(res.total, 0);
  assert.equal(res.totalKind, "search_hits");
  assert.match(res.note, /NOT the user's owned DTU total/);
});
