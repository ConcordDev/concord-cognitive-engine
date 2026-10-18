// Chat-par workflow fixes (2026-10-17): routing of real Chat workflows to the
// agent tool loop, news search, compute precedence, Chat tool-card shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatAgentRoute, clientToolCall, webAgentMessage } from "../lib/chat/agent-route.js";
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
  for (const p of ["Give me one sentence about the moon.", "play a game with me",
    "I need to add more protein to my meals", "save a DTU titled X with content Y"]) {
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
  assert.match(rows[0].snippet, /^Reuters, [A-Z][a-z]{2} \d{1,2}, 20\d\d: A deal was signed\./);
  assert.ok(rows[0].publishedAt);
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

test("a complete tool call missing its closing bracket still runs", async () => {
  const { parseToolCalls } = await import("../lib/chat-agent.js");
  const call = `[TOOL_CALL: {"tool": "run_lens_action", "params": {"domain": "food", "action": "recipe-create", "params": {"title": "p"}}}`;
  assert.equal(parseToolCalls(call).length, 1);
  assert.equal(parseToolCalls(`${call}\nthen more`).length, 1);
  assert.equal(parseToolCalls(`${call} trailing prose`).length, 0);
});

test("real-music term and source links", async () => {
  const { realMusicTerm, withSourceLinks } = await import("../lib/chat/agent-route.js");
  assert.equal(realMusicTerm("Play a real song by Daft Punk."), "Daft Punk");
  assert.equal(realMusicTerm("play Bohemian Rhapsody"), "Bohemian Rhapsody");
  const out = withSourceLinks("Intel news.", [{ title: "Intel", url: "https://a.example/1" }]);
  assert.match(out, /Sources:\n1\. \[Intel\]\(https:\/\/a\.example\/1\)/);
  assert.equal(withSourceLinks("see https://a.example/1", [{ title: "Intel", url: "https://a.example/1" }]), "see https://a.example/1");
});

test("a lens write is reported from the stored record", async () => {
  const { writeReceipt } = await import("../lib/chat/agent-route.js");
  const calls = [
    { tool: "run_lens_action", ok: false, domain: "productivity", action: "task-add", error: "task content required" },
    { tool: "run_lens_action", ok: true, domain: "productivity", action: "task-add", result: { ok: true, result: { task: { id: "tsk_1", content: "buy oat milk", dueDate: null, priority: 4 } } } },
  ];
  assert.equal(writeReceipt(calls), 'Saved in productivity: "buy oat milk" (id tsk_1, no due date).');
  assert.equal(writeReceipt([{ tool: "run_lens_action", ok: true, domain: "food", action: "recipe-list", result: {} }]), "");
});

// Ramaj's iPhone asks, 2026-10-17 20:09-20:11 ET (role founder, long pre-fix session):
// all answered from memory with toolCallCount 0 because none matched a route.
test("casual phone asks reach the tools", () => {
  const cases = [
    ["What trump doing lately", "web"],
    ["Use web search", "web"],
    ["use web search to find what trump is doing", "web"],
    ["what's Elon been up to", "web"],
    ["any updates on the writers strike?", "web"],
    ["whats the latest on the hurricane", "web"],
    ["google it", "web"],
    ["Can you make music", "music"],
    ["make me some beats", "music"],
  ];
  for (const [p, want] of cases) assert.equal(chatAgentRoute(p), want, p);
  for (const p of ["Yo", "Yo wassup", "What are you?", "Okay what can you do?", "What else can you do",
    "what are you doing lately", "what have you been up to", "what's new with you",
    "what's my brother been up to"]) {
    assert.equal(chatAgentRoute(p), null, p);
  }
});

test("a short reply to 'what should I look up?' is the search topic", () => {
  const prevReply = "Got it — I'll run a web search for you. What would you like me to look up?";
  assert.equal(chatAgentRoute("Trump", { prevReply }), "web");
  assert.equal(chatAgentRoute("nah never mind", { prevReply }), null);
  assert.equal(chatAgentRoute("Trump", { prevReply: "Hey. What's good?" }), null);
  assert.equal(chatAgentRoute("Trump", {}), null);
});

test("a bare 'use web search' searches the question just asked", () => {
  const history = [{ role: "user", content: "What trump doing lately" }, { role: "assistant", content: "From memory: ..." }];
  for (const p of ["Use web search", "use web search ", "google it", "look it up", "search the web", "ok search it up please"]) {
    assert.match(webAgentMessage(p, history), /search the web for: What trump doing lately$/, p);
  }
  assert.equal(webAgentMessage("search the web for mars rover news", history), "search the web for mars rover news");
  assert.equal(webAgentMessage("Use web search", []), "Use web search");
});

test("unpunctuated user turns stay in chat history", async () => {
  const { buildChatHistoryMessages } = await import("../lib/chat-reply-policy.js");
  const sess = [
    { role: "user", content: "What trump doing lately" },
    { role: "assistant", content: "From memory he has been campaigning." },
    { role: "user", content: "Use web search " },
  ];
  const h = buildChatHistoryMessages(sess, "Use web search ");
  assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(h[0].content, "What trump doing lately");
  assert.match(webAgentMessage("Use web search ", h.slice(0, -1)), /search the web for: What trump doing lately$/);
});

// Tools by default (Ramaj 2026-10-17 20:24 ET): factual / current / how-to / lookup asks.
test("factual, current, how-to and lookup asks default to a tool", () => {
  for (const p of ["who won the game last night", "latest iPhone price", "how do I fix a leaky faucet",
    "find me a good ramen recipe", "what is the capital of peru", "whats on my calendar today", "how much is bitcoin",
    "best budget headphones", "tell me about the roman empire", "how do I make my song more catchy?"]) {
    assert.equal(chatAgentRoute(p), "lookup", p);
  }
  for (const p of ["Yo wassup", "lol", "thanks bro", "Can you help me", "What are you?", "what do you think about that",
    "im so tired today", "Give me one sentence about the moon.", "write me a poem about rain"]) {
    assert.equal(chatAgentRoute(p), null, p);
  }
  assert.equal(chatAgentRoute("what's the source for that?", { prevRoute: "lookup" }), "lookup");
});

test("find_lens_actions searches every domain by intent", async () => {
  const { findLensActions, executeToolCall } = await import("../lib/chat-agent.js");
  const la = new Map([["productivity.task-add", 1], ["shopping.list-add", 1], ["food.recipe-create", 1], ["finance.budget-get", 1], ["calendar.events-list", 1]]);
  const hits = await findLensActions("add item to my shopping list", la);
  assert.equal(hits[0].key, "shopping.list-add");
  assert.equal((await findLensActions("save a recipe", la))[0].key, "food.recipe-create");
  assert.deepEqual(await findLensActions("the and", la), []);
  const tc = await executeToolCall({ actor: { userId: "u1" } }, async () => ({}), la, { tool: "find_lens_actions", params: { query: "calendar events" } });
  assert.equal(tc.ok, true);
  assert.equal(tc.actions[0].key, "calendar.events-list");
});

test("a bare topic after a search turn is searched; small talk is not", () => {
  assert.equal(chatAgentRoute("Trump", { prevRoute: "web" }), "web");
  assert.equal(chatAgentRoute("Elon Musk", { prevRoute: "lookup" }), "lookup");
  assert.equal(chatAgentRoute("thanks", { prevRoute: "web" }), null);
  assert.equal(chatAgentRoute("cool", { prevRoute: "lookup" }), null);
});

test("web_search drops a year the user never typed and puts fresh news first", async () => {
  const { executeToolCall } = await import("../lib/chat-agent.js");
  const seen = [];
  const runMacro = async (d, n, input) => { seen.push(input.query); return { ok: true, results: [{ title: "Wiki", url: "https://w.example/a", snippet: "old" }] }; };
  const tc = await executeToolCall({ actor: { userId: "u1" }, userPrompt: "latest iPhone price" }, runMacro, new Map(),
    { tool: "web_search", params: { query: "iPhone 17 price 2025" } });
  assert.equal(seen[0], "iPhone 17 price");
  assert.equal(tc.ok, true);
  const tc2 = await executeToolCall({ actor: { userId: "u1" }, userPrompt: "prices in 2025?" }, runMacro, new Map(),
    { tool: "web_search", params: { query: "prices 2025" } });
  assert.equal(seen[1], "prices 2025");
  assert.equal(tc2.ok, true);
});
