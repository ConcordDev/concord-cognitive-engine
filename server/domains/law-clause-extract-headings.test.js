// law-clause-extract-headings.test.js
// FIX-law-003 (GB-1521 slice B6) — clause-extract returned the whole
// contract as one 'Preamble' clause whenever section headings were plain
// Title Case ("Confidentiality", "Governing Law:") instead of numbered or
// ALL-CAPS. A short, mostly-capitalised, punctuation-free line following
// a blank line is now a heading too; ordinary prose does not split.
//
// Run: node --test server/domains/law-clause-extract-headings.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "./law.js";

const actions = new Map();
registerLawActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };
const extract = actions.get("law:clause-extract");

describe("law-003 — clause-extract heading shapes", () => {
  it("splits a Title Case contract into one clause per section", () => {
    const text = [
      "This Master Services Agreement is entered into by the parties below.",
      "",
      "Confidentiality",
      "",
      "Each party shall keep confidential all non-public information received from the other party.",
      "",
      "Term and Termination",
      "",
      "This agreement begins on the Effective Date and continues for twelve months unless terminated earlier.",
      "",
      "Governing Law",
      "",
      "This agreement is governed by the laws of the State of New York.",
    ].join("\n");
    const r = extract(ctx, null, { text });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.clauses.map((c) => c.title), ["Preamble", "Confidentiality", "Term and Termination", "Governing Law"]);
  });

  it("numbered headings still split as before", () => {
    const text = "1. Scope of Work\nThe Provider shall deliver the services described in Exhibit A.\n\n2. Payment Terms\nThe Client shall pay $5,000 within thirty days of invoice.";
    const r = extract(ctx, null, { text });
    assert.deepEqual(r.result.clauses.map((c) => c.title), ["Scope of Work", "Payment Terms"]);
  });

  it("plain prose paragraphs do not false-split", () => {
    const text = "The quick brown fox jumps over the lazy dog near the river bank today.\n\nAnother ordinary paragraph follows here with more plain sentences inside it.";
    const r = extract(ctx, null, { text });
    assert.equal(r.result.clauses.length, 1);
    assert.equal(r.result.clauses[0].title, "Preamble");
  });
});
