// Chat-par workflow fixes (2026-10-17): routing of real Chat workflows to the
// agent tool loop, news search, compute precedence, Chat tool-card shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatAgentRoute, clientToolCall } from "../lib/chat/agent-route.js";
import { routeComputeQuestion } from "../lib/chat/compute-router.js";
import { isNewsQuery, newsTopic, parseBingNewsResults, parseGoogleNewsRss } from "../emergent/conscious-web-search.js";

test("real Chat workflows route to the agent tool loop", () => {
  const cases = [
    ["What's today's top tech news?", "web"],
    ["any big AI news this week?", "web"],
    ["Now convert 65 miles per hour to kilometers per hour.", "compute"],
    ["Save this as a DTU note: my starter is fed at 8am", "save"],
    ["Make me a short upbeat song.", "music"],
    ["Play a real song by Daft Punk.", "music"],
    ["Summarize this page for me: https://en.wikipedia.org/wiki/Ada_Lovelace", "browse"],
    ["Create a recipe in the food lens called pancakes", "action"],
    ["Add a task to my tasks: buy oat milk tomorrow.", "action"],
  ];
  for (const [p, want] of cases) assert.equal(chatAgentRoute(p), want, p);
});

test("conversational prompts stay conversational", () => {
  for (const p of ["Give me one sentence about the moon.", "how do I make my song more catchy?", "play a game with me",
    "I need to add more protein to my meals", "what is the meaning of life", "save a DTU titled X with content Y"]) {
    assert.equal(chatAgentRoute(p), null, p);
  }
});

test("a source/link follow-up stays on web only after a web turn", () => {
  const p = "Tell me more about the first story. What's the source link?";
  assert.equal(chatAgentRoute(p, { prevRoute: "web" }), "web");
  assert.equal(chatAgentRoute("Tell me more about the first story.", {}), null);
});

test("news questions use a news topic, not brand-name keywords", () => {
  assert.equal(isNewsQuery("today's top tech news"), true);
  assert.equal(newsTopic("today's top tech news"), "technology");
  assert.equal(newsTopic("what's happening in the world today"), "");
  assert.equal(newsTopic("latest news about SpaceX"), "spacex");
});

test("Bing News cards parse to publisher article URLs", () => {
  const html = `<div class="news-card newsitem cardcommon" url="https://ex.com/a" data-url="https://ex.com/a" data-title="Chip &amp; AI deal" data-author="Reuters" title="x"><div class="ns_sc_tm">3h</div><div class="snippet" title="s">A deal was signed.</div></div>`
    + `<div class="news-card newsitem cardcommon" data-url="javascript:x" data-title="bad"></div>`;
  const rows = parseBingNewsResults(html, "technology");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://ex.com/a");
  assert.equal(rows[0].title, "Chip & AI deal");
  assert.match(rows[0].snippet, /Reuters, 3h ago: A deal was signed\./);
});

test("Google News RSS fallback strips the outlet suffix", () => {
  const xml = `<rss><channel><item><title>Big thing - The Verge</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Sat, 17 Oct 2026 19:41:05 GMT</pubDate><source url="https://www.theverge.com">The Verge</source></item></channel></rss>`;
  const [r] = parseGoogleNewsRss(xml, "technology");
  assert.equal(r.title, "Big thing");
  assert.equal(r.outlet, "The Verge");
});

test("compute keeps function terms and converts speeds", () => {
  assert.equal(routeComputeQuestion("Calculate (3.75 * 1840) / 12.5 + sqrt(2025)").value, 597);
  const s = routeComputeQuestion("convert 65 miles per hour to kilometers per hour");
  assert.ok(Math.abs(s.value - 104.60736) < 1e-4);
  assert.match(s.text, /65 mph = 104\.607 km\/h/);
  assert.equal(routeComputeQuestion("what is 2+3*4").value, 14);
});

test("agent tool calls get Chat card params and a capped result", () => {
  const tc = clientToolCall({ tool: "run_lens_action", ok: true, domain: "studio", action: "compose", result: { big: "y".repeat(9000) }, artifacts: [{ kind: "song" }] });
  assert.deepEqual(tc.params, { domain: "studio", action: "compose" });
  assert.equal(typeof tc.result, "string");
  assert.ok(tc.result.length < 3100);
  assert.equal(tc.artifacts, undefined);
});
