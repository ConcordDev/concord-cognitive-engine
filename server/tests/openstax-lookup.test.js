// OpenStax textbook lookup (2026-10-17): archive fetch into a local cache,
// passage search, and the textbook_lookup tool wiring for Chat and ConKay.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pageText, queryTerms, bestPassage, textbookLookup, _resetOpenStaxCache } from "../lib/openstax-lookup.js";
import { isTextbookAsk, sourcesFromToolCalls } from "../lib/chat/agent-route.js";
import { conkayTurnPlan, conkayToolPolicy } from "../lib/conkay/agent-turn.js";
import { formatToolResults } from "../lib/chat-agent.js";

const BOOK = "a31df062-930a-4f46-8953-605711e6d204";
const PAGES = {
  p1: { title: "<span>5.3</span> Elasticity: Stress and Strain", slug: "5-3-elasticity-stress-and-strain",
    content: "<p>Y is called the elastic modulus or Young’s modulus.</p><table><tr><th>Material</th><th>Young’s modulus Y (10<sup>9</sup> N/m²)</th></tr><tr><td>Aluminum</td><td>70</td></tr><tr><td>Brass</td><td>90</td></tr></table><annotation encoding=\"x\">junk</annotation>" },
  p2: { title: "12.2 Bernoulli’s Equation", slug: "12-2-bernoullis-equation", content: "<p>Bernoulli’s principle: where speed increases, pressure decreases.</p>" },
};

function fakeFetch() {
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  return async (u) => {
    u = String(u);
    if (u.endsWith("/rex/release.json")) return json({ archiveUrl: "/apps/archive/X", books: { [BOOK]: { defaultVersion: "v1" } } });
    if (u.includes("/apps/cms/api/v2/pages/")) return json({ items: [{ meta: { slug: "college-physics-2e" }, title: "College Physics 2e", cnx_id: BOOK, book_state: "live" }] });
    if (u.endsWith(`/contents/${BOOK}@v1.json`)) {return json({ tree: { contents: [{ contents: [
      { id: "p1@v1", title: PAGES.p1.title, slug: PAGES.p1.slug, toc_target_type: "numbered-section" },
      { id: "p2@v1", title: PAGES.p2.title, slug: PAGES.p2.slug, toc_target_type: "numbered-section" },
      { id: "p3@v1", title: "Problems", slug: "problems", toc_target_type: "composite-page" },
    ] }] } });}
    const m = u.match(/:(p\d)\.json$/);
    if (m && PAGES[m[1]]) return json({ content: PAGES[m[1]].content });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("page text drops MathML annotations and keeps table cells apart", () => {
  const t = pageText(PAGES.p1.content);
  assert.doesNotMatch(t, /junk/);
  assert.match(t, /Aluminum \| 70/);
});

test("query terms drop the ask and keep the fact", () => {
  assert.deepEqual(queryTerms("What's Young's modulus of aluminum per OpenStax"), ["young", "modulus", "aluminum"]);
  assert.deepEqual(queryTerms("explain Bernoulli's principle with a textbook source"), ["bernoulli", "principle"]);
});

test("the passage centres on the rarest term", () => {
  const text = `${"Young’s modulus is a stiffness. ".repeat(40)}Material | Young’s modulus | Aluminum | 70 | Brass | 90`;
  assert.match(bestPassage(text, ["young", "modulus", "aluminum"]), /Aluminum \| 70/);
});

test("textbook lookup caches the book and finds the section with its link", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osx-"));
  process.env.CONCORD_OPENSTAX_CACHE_DIR = dir;
  _resetOpenStaxCache();
  try {
    const r = await textbookLookup("Young's modulus of aluminum per OpenStax", { fetchImpl: fakeFetch(), waitMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.results[0].section, "5.3 Elasticity: Stress and Strain");
    assert.equal(r.results[0].url, "https://openstax.org/books/college-physics-2e/pages/5-3-elasticity-stress-and-strain");
    assert.match(r.results[0].passage, /Aluminum \| 70/);
    assert.match(r.results[0].attribution, /CC BY 4\.0/);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("college-physics-2e@v1")));
    const b = await textbookLookup("Bernoulli's principle", { fetchImpl: async () => { throw new Error("no network on a cached book"); } });
    assert.equal(b.results[0].section, "12.2 Bernoulli’s Equation");
  } finally {
    delete process.env.CONCORD_OPENSTAX_CACHE_DIR;
    _resetOpenStaxCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("textbook asks are recognized and ConKay falls back to textbook_lookup", () => {
  assert.equal(isTextbookAsk("What's Young's modulus of aluminum per OpenStax"), true);
  assert.equal(isTextbookAsk("explain Bernoulli's principle with a textbook source"), true);
  assert.equal(isTextbookAsk("latest iPhone price"), false);
  const plan = conkayTurnPlan("What's Young's modulus of aluminum per OpenStax");
  assert.equal(plan?.fallbackCall?.tool, "textbook_lookup");
  assert.match(conkayToolPolicy(), /textbook_lookup/);
  assert.match(conkayToolPolicy(), /newest dated items/);
});

test("textbook results reach the model and the source list", () => {
  const tc = { tool: "textbook_lookup", ok: true, query: "q", results: [{ book: "College Physics 2e", section: "5.3 Elasticity", url: "https://openstax.org/books/college-physics-2e/pages/5-3", passage: "Aluminum | 70", attribution: "x" }], instruction: "Answer from these." };
  const text = formatToolResults([tc]);
  assert.match(text, /College Physics 2e — 5\.3 Elasticity/);
  assert.match(text, /Aluminum \| 70/);
  assert.equal(sourcesFromToolCalls([tc])[0].url, "https://openstax.org/books/college-physics-2e/pages/5-3");
});
