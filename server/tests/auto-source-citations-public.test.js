// Phase 9a: citation DTUs are public, carry the server-stamped auto-source
// marker (captured here via the real AsyncLocalStorage scope), use the
// publicSafe payload (no page text), and are never tagged "feed". The
// summary DTU is created OUTSIDE the ingest scope.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { autoSource, _resetAutoSourceForTests, hasAutoSourceMarker } from "../lib/auto-source.js";
import { currentFeedIngest } from "../lib/feed-ingest-provenance.js";

function fakeMacro() {
  const creates = [];
  const fn = async (domain, name, input) => {
    if (domain === "dtu" && name === "create") {
      creates.push({ input, ingest: currentFeedIngest() });
      return { ok: true, id: `dtu_${creates.length}` };
    }
    return { ok: true };
  };
  fn.creates = creates;
  return fn;
}

const LONG_TEXT = `Wetlands buffer storm surge along the coast. ${"filler ".repeat(80)}SECRET-TAIL-MARKER`;

beforeEach(() => { _resetAutoSourceForTests(); });

test("citations are public + marked + text-free; summary is private + unmarked", async () => {
  const runMacro = fakeMacro();
  const r = await autoSource({ topic: "wetland storm buffering", userId: "u-cite-1" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => ({ text: "Wetlands slow floodwater and trap sediment before it reaches towns.", title: "USGS wetlands" }),
    summarize: async () => "Wetlands buffer storm surge [1]. They also trap sediment [2].",
    providers: [{
      name: "fake",
      fetch: async () => [
        { title: "Wetlands (Wikipedia)", url: "https://en.wikipedia.org/wiki/Wetland", text: LONG_TEXT, license: "CC BY-SA 4.0, via Wikipedia" },
        { title: "USGS wetlands", url: "https://www.usgs.gov/wetlands" },
      ],
    }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(runMacro.creates.length, 3);
  const [c1, c2, summary] = runMacro.creates;

  for (const c of [c1, c2]) {
    assert.equal(c.input.visibility, "public");
    assert.equal(c.input.source, "auto-source");
    assert.equal(c.input.meta.kind, "citation");
    assert.ok(c.input.tags.includes("auto-source"));
    assert.ok(!c.input.tags.includes("feed"), "citations must never be tagged feed");
    assert.deepEqual(c.ingest, { domain: "research", action: "auto-source" });
    assert.ok(!("feedIngest" in (c.input.meta || {})), "the record itself carries no forged marker");
  }
  // publicSafe: the fetched page text is NOT in the stored payload.
  assert.ok(!c1.input.content.includes("SECRET-TAIL-MARKER"));
  assert.ok(!c1.input.creti.includes("SECRET-TAIL-MARKER"));
  assert.ok(c1.input.content.length < 800, `excerpt must be capped, got ${c1.input.content.length}`);
  assert.equal(c1.input.meta.license, "CC BY-SA 4.0, via Wikipedia");

  // The stored-row marker check the boot machinery will use.
  assert.equal(hasAutoSourceMarker({ meta: { kind: "citation", feedIngest: { domain: "research", action: "auto-source", source: "auto-source" } } }), true);
  assert.equal(hasAutoSourceMarker({ meta: { kind: "citation", feedIngest: { domain: "research", action: "feed", source: "auto-source" } } }), false);
  assert.equal(hasAutoSourceMarker({ meta: { kind: "citation" } }), false);

  assert.equal(summary.input.visibility, "private");
  assert.equal(summary.ingest, null);
  assert.equal(summary.input.meta.kind, "auto-source");
});
