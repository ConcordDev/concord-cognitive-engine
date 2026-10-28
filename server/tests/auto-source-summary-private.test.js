// Phase 9a: the summary DTU is private with >=2 grounded sources, and only
// its author can publish it; publishing re-checks that every cited DTU
// still exists.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { autoSource, publishAutoSourceSummary, _resetAutoSourceForTests } from "../lib/auto-source.js";

function fakeMacro() {
  const creates = [];
  const fn = async (domain, name, input) => {
    if (domain === "dtu" && name === "create") { creates.push(input); return { ok: true, id: `dtu_${creates.length}` }; }
    return { ok: true };
  };
  fn.creates = creates;
  return fn;
}

async function buildSummary(runMacro, userId) {
  return autoSource({ topic: "wetland storm buffering", userId }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => ({ text: "Wetlands slow floodwater and trap sediment.", title: "USGS" }),
    summarize: async () => "Wetlands buffer storm surge [1]. They trap sediment too [2].",
    providers: [{
      name: "fake",
      fetch: async () => [
        { title: "Wetlands (Wikipedia)", url: "https://en.wikipedia.org/wiki/Wetland", text: "Wetlands absorb storm surge." },
        { title: "USGS wetlands", url: "https://www.usgs.gov/wetlands" },
      ],
    }],
  });
}

beforeEach(() => { _resetAutoSourceForTests(); });

test("summary is private, grounded on >=2 sources, and publish is author-only with citation re-check", async () => {
  const runMacro = fakeMacro();
  const r = await buildSummary(runMacro, "author-1");
  assert.equal(r.ok, true, JSON.stringify(r));
  const summary = runMacro.creates.find((c) => c.meta?.kind === "auto-source");
  assert.equal(summary.visibility, "private");
  assert.ok(summary.meta.sources.length >= 2);
  assert.equal(summary.meta.userId, "author-1");
  assert.equal(summary.meta.citationIds.length, r.citationIds.length);

  const store = new Map();
  store.set(r.summaryId, { id: r.summaryId, visibility: "private", meta: { kind: "auto-source", userId: "author-1", citationIds: r.citationIds } });
  for (const id of r.citationIds) store.set(id, { id, visibility: "public", meta: { kind: "citation" } });
  const getDtu = async (id) => store.get(id) || null;
  const flips = [];
  const setVisibility = async (id, vis) => { flips.push([id, vis]); store.get(id).visibility = vis; return true; };

  // Another user cannot publish it.
  const denied = await publishAutoSourceSummary({ summaryId: r.summaryId, userId: "someone-else" }, { getDtu, setVisibility });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(flips.length, 0);

  // A missing citation blocks publishing.
  const orphanId = r.citationIds[0];
  const kept = store.get(orphanId); store.delete(orphanId);
  const blocked = await publishAutoSourceSummary({ summaryId: r.summaryId, userId: "author-1" }, { getDtu, setVisibility });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  store.set(orphanId, kept);

  // The author publishes; a second publish is a no-op success.
  const pub = await publishAutoSourceSummary({ summaryId: r.summaryId, userId: "author-1" }, { getDtu, setVisibility });
  assert.equal(pub.ok, true);
  assert.deepEqual(flips, [[r.summaryId, "public"]]);
  const again = await publishAutoSourceSummary({ summaryId: r.summaryId, userId: "author-1" }, { getDtu, setVisibility });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyPublished, true);
});
