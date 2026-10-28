// Phase 9a: with fewer than 2 independent sources cited, auto-source saves
// NOTHING — no citation DTUs, no summary. No network: providers, the page
// fetcher, the summarizer and the macro runtime are all fakes.
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

test("one fetched source => insufficient_sources and zero DTUs written", async () => {
  const runMacro = fakeMacro();
  const r = await autoSource({ topic: "lunar dust mitigation", userId: "u-min-1" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => ({ text: "Lunar dust is abrasive and clings to suits and seals.", title: "Dust" }),
    summarize: async () => "Lunar dust clings to suits [1].",
    providers: [{ name: "fake", fetch: async () => [{ title: "Dust", url: "https://www.nasa.gov/dust" }] }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "insufficient_sources");
  assert.equal(runMacro.creates.length, 0);
});

test("two fetched pages on the SAME registrable domain still fail the gate", async () => {
  const runMacro = fakeMacro();
  const r = await autoSource({ topic: "lunar dust mitigation", userId: "u-min-2" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => ({ text: "Some fetched page text about lunar dust and seals.", title: "P" }),
    summarize: async () => "First fact [1]. Second fact [2].",
    providers: [{
      name: "fake",
      fetch: async () => [
        { title: "A", url: "https://www.nasa.gov/a" },
        { title: "B", url: "https://science.nasa.gov/b" },
      ],
    }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "insufficient_sources");
  assert.equal(runMacro.creates.length, 0);
});

test("no provider finds anything => insufficient_sources, nothing written", async () => {
  const runMacro = fakeMacro();
  const r = await autoSource({ topic: "obscure topic xyz", userId: "u-min-3" }, {
    runMacro,
    searchDtus: async () => [],
    fetchPage: async () => null,
    summarize: async () => "Nothing [1].",
    providers: [{ name: "fake", fetch: async () => [] }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "insufficient_sources");
  assert.equal(runMacro.creates.length, 0);
});
