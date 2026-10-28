// Phase 9a: any summary sentence without a valid [n] citation is dropped
// before the summary DTU is written — cite-or-drop, no exceptions.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { autoSource, citedSentences, _resetAutoSourceForTests } from "../lib/auto-source.js";

test("citedSentences keeps only sentences with a valid citation", () => {
  const { text, cited } = citedSentences("Kept fact [1]. This claim has no citation. Another kept [2]. Bogus cite [9] here.", 2);
  assert.equal(text, "Kept fact [1]. Another kept [2].");
  assert.deepEqual([...cited].sort(), [1, 2]);
});

test("uncited sentences never reach the saved summary", async () => {
  _resetAutoSourceForTests();
  const creates = [];
  const runMacro = async (domain, name, input) => {
    if (domain === "dtu" && name === "create") { creates.push(input); return { ok: true, id: `dtu_${creates.length}` }; }
    return { ok: true };
  };
  const r = await autoSource({ topic: "wetland storm buffering", userId: "u-uncited-1" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => ({ text: "Wetlands slow floodwater and trap sediment.", title: "USGS" }),
    summarize: async () => "Wetlands buffer storm surge [1]. Experts agree this is definitely true. Sediment is trapped as well [2].",
    providers: [{
      name: "fake",
      fetch: async () => [
        { title: "Wetlands (Wikipedia)", url: "https://en.wikipedia.org/wiki/Wetland", text: "Wetlands absorb storm surge." },
        { title: "USGS wetlands", url: "https://www.usgs.gov/wetlands" },
      ],
    }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const summary = creates.find((c) => c.meta?.kind === "auto-source");
  assert.ok(summary.content.includes("Wetlands buffer storm surge [1]."));
  assert.ok(summary.content.includes("Sediment is trapped as well [2]."));
  assert.ok(!summary.content.includes("Experts agree"));
});
