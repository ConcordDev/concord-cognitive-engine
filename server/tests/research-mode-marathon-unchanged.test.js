// Phase 9a guard: the research-mode refactor (buildCitationRecords /
// writeCitationDtus) must leave the marathon path's output byte-identical:
// same create payloads, same dedupe, same session-meta patch. Uses a stub
// db (no better-sqlite3 needed) and a fake macro runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveCitationDtus, cleanExcerpt } from "../lib/research-mode.js";

// Fixture hosts are full-tier (.gov): since #1692 a non-full-tier citation is
// stored summary-only (tests/restricted-ingest-guard.test.js covers that path),
// so this refactor-parity check uses hosts whose page text is still kept.

function fakeDb() {
  const store = new Map();
  return {
    _store: store,
    prepare: () => ({
      get: (id) => { const v = store.get(id); return v ? { meta_json: v } : undefined; },
      run: (json, id) => { store.set(id, json); },
    }),
  };
}

const PAGE_TEXT = "The MG996R is a metal-gear servo with 11 kg-cm of stall torque at 6 V and a fast transit time across the full sweep range.";
const TOOL_CALLS = [
  {
    tool: "browse_url",
    url: "https://nist.gov/mg996r?utm_source=test",
    title: "MG996R datasheet",
    text: PAGE_TEXT,
    publishedAt: "2026-01-15",
  },
  {
    tool: "web_search",
    result: JSON.stringify({
      results: [{ title: "Servo torque guide", url: "https://energy.gov/torque", snippet: "How stall torque is measured for hobby servos in practice." }],
    }),
  },
];

test("marathon saveCitationDtus output is unchanged after the refactor", async () => {
  const db = fakeDb();
  const session = { id: "sess1", user_id: "u1", goal: "MG996R servo torque", title: "research servos" };
  const calls = [];
  const runMacro = async (domain, name, input, ctx) => {
    calls.push({ domain, name, input, ctx });
    return { ok: true, id: `dtu_c${calls.length}` };
  };

  const saved = await saveCitationDtus(db, session, TOOL_CALLS, runMacro);
  assert.equal(saved.length, 2);
  assert.equal(calls.length, 2);

  // Pages are written before search hits.
  const page = calls[0];
  assert.equal(page.domain, "dtu");
  assert.equal(page.name, "create");
  assert.equal(page.input.title, "Source: MG996R datasheet");
  assert.equal(page.input.content, `MG996R datasheet\nhttps://nist.gov/mg996r\n\n${cleanExcerpt(PAGE_TEXT, 4000)}`);
  assert.equal(page.input.creti, page.input.content);
  assert.deepEqual(page.input.tags, ["citation", "web-source", "research", "nist.gov"]);
  assert.equal(page.input.source, "agent_tool");
  assert.equal(page.input.visibility, "private");
  assert.equal(page.input.meta.kind, "citation");
  assert.equal(page.input.meta.sourceKind, "page");
  assert.equal(page.input.meta.marathonSessionId, "sess1");
  assert.equal(page.input.meta.url, "https://nist.gov/mg996r");
  assert.equal(page.ctx.actor.userId, "u1");
  assert.equal(page.ctx.actor.sessionId, "sess1");

  const hit = calls[1];
  assert.equal(hit.input.meta.sourceKind, "search");
  assert.equal(hit.input.content, `Servo torque guide\nhttps://energy.gov/torque\n\nHow stall torque is measured for hobby servos in practice.`);

  // Session meta gained the citation bookkeeping.
  const meta = JSON.parse(db._store.get("sess1"));
  assert.deepEqual(meta.citationDtuIds, ["dtu_c1", "dtu_c2"]);
  assert.deepEqual(meta.citationUrls, ["https://nist.gov/mg996r", "https://energy.gov/torque"]);
  assert.equal(meta.citations.length, 2);
  assert.equal(meta.citations[0].kind, "page");
  assert.ok(meta.citations[0].text.length > 0, "private marathon citations keep the page excerpt");

  // A second identical call dedupes against the session meta: nothing new.
  const again = await saveCitationDtus(db, session, TOOL_CALLS, runMacro);
  assert.equal(again.length, 0);
  assert.equal(calls.length, 2);
});
