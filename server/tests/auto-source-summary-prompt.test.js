import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummaryPrompt, selectSummarySources } from "../lib/auto-source.js";

test("summary sources are spread across domains so one provider cannot fill every slot", () => {
  const wiki = Array.from({ length: 5 }, (_, i) => ({ url: `https://en.wikipedia.org/wiki/P${i}`, host: "en.wikipedia.org", text: "w" }));
  const doi = Array.from({ length: 3 }, (_, i) => ({ url: `https://doi.org/10.1/${i}`, host: "doi.org", text: "d" }));
  const arx = [{ url: "http://arxiv.org/abs/1", host: "arxiv.org", text: "a" }];
  const sel = selectSummarySources([...wiki, ...doi, ...arx], 6);
  assert.equal(sel.length, 6);
  const hosts = sel.map((s) => s.host);
  assert.deepEqual(hosts.slice(0, 3), ["en.wikipedia.org", "doi.org", "arxiv.org"]);
  assert.ok(hosts.filter((h) => h === "en.wikipedia.org").length <= 3);
});

test("summary prompt puts the citation rule after the material and trims each source", () => {
  const long = "x".repeat(5000);
  const p = buildSummaryPrompt("topic", [{ n: 1, title: "A", text: long }, { n: 2, title: "B", text: "short" }]);
  assert.ok(p.indexOf("[1] A") < p.indexOf("square brackets"));
  assert.ok(p.length < 2000, `prompt too long: ${p.length}`);
  assert.match(p, /at least two different sources/);
});
