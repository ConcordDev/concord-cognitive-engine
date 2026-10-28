// restricted-ingest-guard — enforceSummaryOnly (news-outlet-policy.js) and
// its wiring in research-mode's saveCitationDtus: new ingest from a
// non-full-tier outlet can only save the summary-only shape, never the
// page text. Full-tier ingest is byte-identical to before. No network, no
// real DB: saveCitationDtus runs against a fake runMacro + fake db.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { enforceSummaryOnly } = await import("../lib/news-outlet-policy.js");
const { saveCitationDtus } = await import("../lib/research-mode.js");

const PAGE_TEXT = [
  "The first long paragraph of the article explains the decision in detail for readers.",
  "A second paragraph adds background, quotes from officials, and the expected timeline.",
  "A third paragraph covers the reaction from residents, businesses, and advocacy groups.",
].join("\n");

describe("enforceSummaryOnly", () => {
  const draft = () => ({
    title: "Source: Council approves transit plan",
    content: `Council approves transit plan\nhttps://www.theverge.com/x\n\n${PAGE_TEXT}`,
    creti: `Council approves transit plan\nhttps://www.theverge.com/x\n\n${PAGE_TEXT}`,
    human: { summary: PAGE_TEXT.slice(0, 200), bullets: ["https://www.theverge.com/x"] },
    meta: { url: "https://www.theverge.com/x", sourceName: "The Verge", publishedAt: "2026-10-01T12:00:00Z" },
  });

  it("restricted host: page text stripped to the summary-only shape", () => {
    const out = enforceSummaryOnly(draft());
    assert.ok(!out.content.includes("first long paragraph"));
    assert.ok(out.content.includes("Link: https://www.theverge.com/x"));
    assert.ok(out.content.includes("Source: The Verge"));
    assert.ok(out.content.includes("Published: 2026-10-01T12:00:00Z"));
    assert.equal(out.creti, out.content);
    assert.equal(out.human.summary, "");
    assert.deepEqual(out.human.bullets, ["https://www.theverge.com/x"]);
    assert.equal(out.contentPolicy, "summary-only");
    assert.equal(out.meta.contentPolicy, "summary-only");
    assert.equal(out.meta.url, "https://www.theverge.com/x", "source link preserved");
  });

  it("does not mutate the input draft", () => {
    const d = draft();
    enforceSummaryOnly(d);
    assert.ok(d.content.includes("first long paragraph"));
    assert.equal(d.contentPolicy, undefined);
  });

  it("full-tier host: returned unchanged (same reference)", () => {
    const d = { title: "NASA update", content: PAGE_TEXT, meta: { sourceUrl: "https://www.nasa.gov/x" } };
    assert.equal(enforceSummaryOnly(d), d);
  });

  it("no URL: returned unchanged (not attributable to an outlet)", () => {
    const d = { title: "Note", content: PAGE_TEXT };
    assert.equal(enforceSummaryOnly(d), d);
  });

  it("a validated Concord summary is kept; a copied one is dropped", () => {
    const good = enforceSummaryOnly(draft(), {
      concordSummary: "The council backed a transit expansion adding bus routes and a rebuilt station, with work starting in spring.",
    });
    assert.ok(good.content.includes("Concord summary: The council backed a transit expansion"));
    const copied = PAGE_TEXT.split(/\s+/).slice(0, 15).join(" ");
    const bad = enforceSummaryOnly(draft(), { concordSummary: copied });
    assert.ok(!bad.content.includes("Concord summary:"));
  });
});

describe("saveCitationDtus — the research-mode ingest guard", () => {
  const fakeDb = () => ({
    prepare(sql) {
      if (sql.includes("SELECT")) return { get: () => ({ meta_json: "{}" }) };
      return { run: () => ({}) };
    },
  });
  const session = { id: "sess_1", user_id: "u1", title: "" };
  const pageCall = (url, title) => ({
    tool: "browse_url",
    ok: true,
    url,
    title,
    text: PAGE_TEXT,
  });

  it("a theverge.com page is saved WITHOUT its text", async () => {
    const drafts = [];
    const runMacro = async (_domain, _name, input) => { drafts.push(input); return { ok: true, id: "dtu_1" }; };
    const ids = await saveCitationDtus(fakeDb(), session, [pageCall("https://www.theverge.com/2026/10/1/transit", "Transit plan approved")], runMacro);
    assert.deepEqual(ids, ["dtu_1"]);
    assert.equal(drafts.length, 1);
    const d = drafts[0];
    assert.ok(!JSON.stringify(d).includes("first long paragraph"), "no page text anywhere in the saved draft");
    assert.ok(d.content.includes("Link: https://www.theverge.com/2026/10/1/transit"));
    assert.equal(d.human.summary, "");
    assert.equal(d.contentPolicy, "summary-only");
    assert.equal(d.visibility, "private");
  });

  it("a nasa.gov page is saved WITH its text, unchanged", async () => {
    const drafts = [];
    const runMacro = async (_domain, _name, input) => { drafts.push(input); return { ok: true, id: "dtu_2" }; };
    const ids = await saveCitationDtus(fakeDb(), session, [pageCall("https://www.nasa.gov/news/update", "NASA update")], runMacro);
    assert.deepEqual(ids, ["dtu_2"]);
    const d = drafts[0];
    assert.ok(d.content.includes("first long paragraph"), "full-tier page text is kept");
    assert.equal(d.contentPolicy, undefined);
    assert.ok(d.human.summary.length > 0, "full-tier excerpt summary is kept");
  });
});
