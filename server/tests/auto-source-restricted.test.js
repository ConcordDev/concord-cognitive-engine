// Phase 9a: restricted outlets (licensing policy) are NEVER fetched and
// their citation DTUs carry no excerpt — headline + link + date only.
// Ramaj's Oct 27 decisions additionally exclude Al Jazeera / France 24 /
// ABC AU entirely, and DW / CBC are off until agreements exist — those
// candidates are dropped, not cited.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { autoSource, _resetAutoSourceForTests } from "../lib/auto-source.js";

function fakeMacro() {
  const creates = [];
  const fn = async (domain, name, input) => {
    if (domain === "dtu" && name === "create") { creates.push(input); return { ok: true, id: `dtu_${creates.length}` }; }
    return { ok: true };
  };
  fn.creates = creates;
  return fn;
}

beforeEach(() => { _resetAutoSourceForTests(); });

test("restricted hosts: not fetched, citation has no excerpt; excluded/decision-off hosts dropped", async () => {
  const runMacro = fakeMacro();
  const fetchedUrls = [];
  const r = await autoSource({ topic: "coastal flooding response", userId: "u-restr-1" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async (url) => { fetchedUrls.push(url); return { text: "Flood defenses held along the estuary overnight.", title: "USGS" }; },
    summarize: async () => "Wetlands buffer surge [1]. Defenses held overnight [2].",
    providers: [{
      name: "fake",
      fetch: async () => [
        { title: "Wetlands (Wikipedia)", url: "https://en.wikipedia.org/wiki/Wetland", text: "Wetlands absorb storm surge and slow floodwater." },
        { title: "Guardian floods story", url: "https://www.theguardian.com/world/floods", outlet: "The Guardian", published: "2026-10-01" },
        { title: "Al Jazeera floods story", url: "https://www.aljazeera.com/news/floods" },
        { title: "DW floods story", url: "https://www.dw.com/en/floods" },
        { title: "USGS flood page", url: "https://www.usgs.gov/floods" },
      ],
    }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  // Only the fetchable USGS page went through fetchPage.
  assert.deepEqual(fetchedUrls, ["https://www.usgs.gov/floods"]);

  const citations = runMacro.creates.filter((c) => c.meta?.kind === "citation");
  const urls = citations.map((c) => c.meta.url);
  assert.ok(urls.includes("https://www.theguardian.com/world/floods"));
  assert.ok(!urls.some((u) => u.includes("aljazeera.com")), "Al Jazeera is excluded by decision");
  assert.ok(!urls.some((u) => u.includes("dw.com")), "DW is off by decision");

  const guardian = citations.find((c) => c.meta.url.includes("theguardian.com"));
  assert.equal(guardian.content, "Guardian floods story\nhttps://www.theguardian.com/world/floods");
  assert.equal(guardian.meta.published, "2026-10-01");
  assert.equal(guardian.meta.outlet, "The Guardian");
});
