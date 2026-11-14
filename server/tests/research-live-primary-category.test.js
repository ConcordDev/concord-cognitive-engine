/**
 * FIX-neuro-006 — arXiv category feeds list PRIMARY-category papers.
 *
 * The ticket: the Neuro lens's Research feed (cat:q-bio.NC) listed a
 * linguistics paper — arXiv's cat: clause matches cross-listed papers,
 * and the parser ignored <arxiv:primary_category>. On pure category
 * feeds the macro now keeps primary matches; entries whose primary is
 * not stated are kept, and a filter that would empty a non-empty feed
 * falls back to the raw set (a category feed never fakes empty).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import registerResearchLiveMacros, {
  parseArxivAtom,
  filterToPrimaryCategory,
} from "../domains/research-live.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.11111v1</id>
    <title>Spiking networks for sequence modelling</title>
    <summary>A neuroscience paper.</summary>
    <published>2024-01-22T18:00:00Z</published>
    <updated>2024-01-23T09:00:00Z</updated>
    <author><name>Alice Aardvark</name></author>
    <category term="q-bio.NC"/>
    <category term="cs.NE"/>
    <arxiv:primary_category term="q-bio.NC"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.22222v1</id>
    <title>Parsing garden-path sentences at scale</title>
    <summary>A linguistics paper, cross-listed to q-bio.NC.</summary>
    <published>2024-01-22T18:00:00Z</published>
    <updated>2024-01-23T09:00:00Z</updated>
    <author><name>Bob Beetle</name></author>
    <category term="cs.CL"/>
    <category term="q-bio.NC"/>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.33333v1</id>
    <title>An older feed entry without the primary marker</title>
    <summary>No primary_category element.</summary>
    <published>2024-01-22T18:00:00Z</published>
    <updated>2024-01-23T09:00:00Z</updated>
    <author><name>Carol Crow</name></author>
    <category term="q-bio.NC"/>
  </entry>
</feed>`;

describe("FIX-neuro-006 — parseArxivAtom primary category", () => {
  it("extracts arxiv:primary_category per entry", () => {
    const entries = parseArxivAtom(FEED);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].primaryCategory, "q-bio.NC");
    assert.equal(entries[1].primaryCategory, "cs.CL");
    assert.equal(entries[2].primaryCategory, null);
  });
});

describe("FIX-neuro-006 — filterToPrimaryCategory", () => {
  it("drops a cross-listed foreign-primary paper, keeps primary + unknown", () => {
    const kept = filterToPrimaryCategory(parseArxivAtom(FEED), "q-bio.NC");
    assert.deepEqual(kept.map((e) => e.arxivId), ["2401.11111v1", "2401.33333v1"]);
  });

  it("dotless categories match their subcategories", () => {
    const entries = [
      { arxivId: "a", primaryCategory: "q-bio.NC" },
      { arxivId: "b", primaryCategory: "cs.CL" },
    ];
    assert.deepEqual(filterToPrimaryCategory(entries, "q-bio").map((e) => e.arxivId), ["a"]);
  });

  it("never fakes an empty feed: all-foreign falls back to the raw set", () => {
    const entries = [{ arxivId: "x", primaryCategory: "cs.CL" }];
    assert.equal(filterToPrimaryCategory(entries, "q-bio.NC"), entries);
  });
});

describe("FIX-neuro-006 — the neuro live_arxiv macro applies the filter", () => {
  const realFetch = globalThis.fetch;
  const ACTIONS = new Map();
  beforeEach(() => {
    ACTIONS.clear();
    registerResearchLiveMacros((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
    globalThis.fetch = async () => ({ ok: true, text: async () => FEED });
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("the q-bio.NC category feed excludes the cs.CL-primary paper", async () => {
    const fn = ACTIONS.get("neuro.live_arxiv");
    assert.ok(fn, "neuro.live_arxiv registered");
    const r = await fn({}, {});
    assert.equal(r.ok, true, JSON.stringify(r));
    const ids = r.papers.map((p) => p.arxivId);
    assert.ok(ids.includes("2401.11111v1"), "primary q-bio.NC paper listed");
    assert.ok(!ids.includes("2401.22222v1"), "cs.CL-primary cross-list NOT listed");
  });
});
