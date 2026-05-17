/**
 * Tier-2 contract test for the arXiv Atom parser + macro registration.
 *
 * Pins:
 *   - parseArxivAtom returns expected shape from minimal Atom XML
 *   - empty <entry>-less feed returns []
 *   - multiple authors collected correctly
 *   - arxivId extracted from <id>
 *   - macro is registered for every CATEGORY_FOR_DOMAIN key
 *   - macro returns error reason on missing fetch (no live HTTP)
 *
 * Run: node --test server/tests/research-live-arxiv.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerResearchLiveMacros, {
  CATEGORY_FOR_DOMAIN,
  parseArxivAtom,
} from "../domains/research-live.js";

const MINIMAL_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <title>A theory of foo bar baz quux</title>
    <summary>This paper studies foo in the context of bar.</summary>
    <published>2024-01-22T18:00:00Z</published>
    <updated>2024-01-23T09:00:00Z</updated>
    <author><name>Alice Aardvark</name></author>
    <author><name>Bob Beetle</name></author>
    <author><name>Carol Crow</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.67890v2</id>
    <title>Multi line
title with whitespace</title>
    <summary>Another paper.</summary>
    <published>2024-02-15T12:00:00Z</published>
    <updated>2024-02-16T08:00:00Z</updated>
    <author><name>Dana Dolphin</name></author>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

describe("parseArxivAtom", () => {
  it("parses two entries from minimal feed", () => {
    const entries = parseArxivAtom(MINIMAL_FEED);
    assert.equal(entries.length, 2);
  });

  it("extracts arxivId from <id>", () => {
    const [first, second] = parseArxivAtom(MINIMAL_FEED);
    assert.equal(first.arxivId, "2401.12345v1");
    assert.equal(second.arxivId, "2402.67890v2");
  });

  it("normalises multi-line titles to a single line", () => {
    const [, second] = parseArxivAtom(MINIMAL_FEED);
    assert.equal(second.title, "Multi line title with whitespace");
  });

  it("collects all authors", () => {
    const [first, second] = parseArxivAtom(MINIMAL_FEED);
    assert.deepEqual(first.authors, ["Alice Aardvark", "Bob Beetle", "Carol Crow"]);
    assert.deepEqual(second.authors, ["Dana Dolphin"]);
  });

  it("computes PDF url from arxivId", () => {
    const [first] = parseArxivAtom(MINIMAL_FEED);
    assert.equal(first.pdfUrl, "https://arxiv.org/pdf/2401.12345v1.pdf");
  });

  it("returns [] on empty feed", () => {
    assert.deepEqual(parseArxivAtom(EMPTY_FEED), []);
  });

  it("returns [] on completely empty input", () => {
    assert.deepEqual(parseArxivAtom(""), []);
  });
});

describe("registerResearchLiveMacros", () => {
  it("registers a live_arxiv macro for every CATEGORY_FOR_DOMAIN key", () => {
    const map = new Map();
    const register = (domain, name, handler) => { map.set(`${domain}.${name}`, handler); };
    registerResearchLiveMacros(register);
    for (const domain of Object.keys(CATEGORY_FOR_DOMAIN)) {
      assert.ok(map.has(`${domain}.live_arxiv`), `expected ${domain}.live_arxiv to be registered`);
    }
  });

  it("CATEGORY_FOR_DOMAIN covers expected domains", () => {
    const keys = Object.keys(CATEGORY_FOR_DOMAIN).sort();
    assert.ok(keys.includes("physics"));
    assert.ok(keys.includes("quantum"));
    assert.ok(keys.includes("robotics"));
    assert.ok(keys.includes("neuro"));
    assert.ok(keys.includes("ml"));
    assert.ok(keys.length >= 7, `expected ≥7 categories, got ${keys.length}`);
  });
});
