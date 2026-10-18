// Fresh answers for news, scores and prices (2026-10-17): dated news merge,
// ESPN scoreboard rows, Coinbase spot rows, weather place parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publishedFromAge, dateLabel, mergeNewest, isNewsQuery, isSportsResultQuery,
  espnRows, cryptoSymbols, compactSearchQuery,
} from "../emergent/conscious-web-search.js";
import { extractWeatherLocation } from "../lib/chat/weather-location.js";
import { WEB_GROUNDING_RULE } from "../lib/chat/link-grounding.js";

test("Bing News ages become timestamps", () => {
  const now = Date.parse("2026-10-17T20:00:00Z");
  assert.equal(publishedFromAge("30m", now), new Date(now - 30 * 60e3).toISOString());
  assert.equal(publishedFromAge("2h", now), new Date(now - 2 * 3600e3).toISOString());
  assert.equal(publishedFromAge("1d", now), new Date(now - 86400e3).toISOString());
  assert.equal(publishedFromAge("", now), null);
  assert.equal(dateLabel("2026-10-16T12:00:00Z"), "Oct 16, 2026");
});

test("news merge dedupes and puts the newest first", () => {
  const rows = mergeNewest([
    { title: "Old story", url: "https://a.example/1", publishedAt: "2026-10-10T00:00:00Z" },
    { title: "New story", url: "https://b.example/2", publishedAt: "2026-10-17T00:00:00Z" },
    { title: "New Story!", url: "https://news.google.com/x", publishedAt: "2026-10-17T00:00:00Z" },
    { title: "Old story", url: "https://a.example/1", publishedAt: "2026-10-10T00:00:00Z" },
  ]);
  assert.deepEqual(rows.map((r) => r.url), ["https://b.example/2", "https://a.example/1"]);
});

test("'what is X doing lately' is a news query; prices, scores and recipes are not", () => {
  for (const q of ["what's trump doing lately", "Trump latest", "any update on the strike", "what happened with OpenAI this week"]) {
    assert.equal(isNewsQuery(q), true, q);
  }
  for (const q of ["latest iPhone price", "who won the game last night", "good ramen recipe", "latest node version"]) {
    assert.equal(isNewsQuery(q), false, q);
  }
});

test("sports result questions are recognized", () => {
  for (const q of ["who won the game last night", "did the yankees win last night", "lakers score tonight"]) assert.equal(isSportsResultQuery(q), true, q);
  for (const q of ["good ramen recipe", "bitcoin price"]) assert.equal(isSportsResultQuery(q), false, q);
});

test("ESPN scoreboard events become dated final-score rows; postponed games carry no score", () => {
  const ev = (id, state, completed, detail, home, away) => ({
    id, date: "2026-10-16T23:30Z", name: `${away[0]} at ${home[0]}`,
    links: [{ href: `https://www.espn.com/nba/game/_/gameId/${id}` }],
    status: { type: { state, completed, detail, shortDetail: detail } },
    competitions: [{ competitors: [
      { homeAway: "home", score: String(home[1]), winner: home[1] > away[1], team: { displayName: home[0], abbreviation: home[0].slice(0, 3).toUpperCase() } },
      { homeAway: "away", score: String(away[1]), winner: away[1] > home[1], team: { displayName: away[0], abbreviation: away[0].slice(0, 3).toUpperCase() } },
    ] }],
  });
  const rows = espnRows({ events: [
    ev("1", "post", true, "Final", ["Los Angeles Lakers", 106], ["Denver Nuggets", 121]),
    ev("2", "post", false, "Postponed", ["Cleveland Guardians", 0], ["Tampa Bay Rays", 0]),
  ] }, "NBA");
  assert.match(rows[0].title, /^NBA: Denver Nuggets 121, Los Angeles Lakers 106 \(Final, Oct 16, 2026\)$/);
  assert.equal(rows[0].outlet, "ESPN");
  assert.ok(rows[0].publishedAt);
  assert.doesNotMatch(rows[1].title, /\b0, /);
  assert.match(rows[1].title, /Postponed/);
});

test("crypto symbols come from coin names and tickers", () => {
  assert.deepEqual(cryptoSymbols("bitcoin price"), ["BTC"]);
  assert.deepEqual(cryptoSymbols("how much is eth right now"), ["ETH"]);
  assert.deepEqual(cryptoSymbols("good ramen recipe"), []);
});

test("subject-first queries for the keyless index", () => {
  assert.equal(compactSearchQuery("find me a good ramen recipe").toLowerCase().startsWith("ramen"), true);
  assert.equal(compactSearchQuery("latest iPhone price").toLowerCase().startsWith("iphone"), true);
});

test("weather place comes from 'X weather' as well as 'weather in X'", () => {
  assert.equal(extractWeatherLocation("NYC weather"), "New York City");
  assert.equal(extractWeatherLocation("weather in NYC today"), "New York City");
  assert.equal(extractWeatherLocation("Chicago forecast"), "Chicago");
  assert.equal(extractWeatherLocation("temperature in Paris right now"), "Paris");
  assert.equal(extractWeatherLocation("will it rain tomorrow"), "");
});

test("grounding rule asks for the newest dated items first", () => {
  assert.match(WEB_GROUNDING_RULE, /newest/);
  assert.match(WEB_GROUNDING_RULE, /outlet and date/);
});

test("model rewrites keep news and scores intent", async () => {
  const { newsTopic } = await import("../emergent/conscious-web-search.js");
  assert.equal(newsTopic("Donald Trump recent activities"), "donald trump");
  assert.equal(isNewsQuery("Donald Trump recent activities"), true);
  assert.equal(isSportsResultQuery("game last night winner"), true);
});

test("news merge gives each provider half the slots", () => {
  const mk = (p, i, h) => ({ provider: p, title: `${p} ${i}`, url: `https://${p}.example/${i}`, publishedAt: new Date(Date.parse("2026-10-17T20:00:00Z") - h * 3600e3).toISOString() });
  const rows = mergeNewest([...[0, 1, 2, 3, 4, 5].map((i) => mk("bing-news", i, i)), ...[0, 1, 2, 3].map((i) => mk("google-news", i, 10 + i))], 6);
  assert.equal(rows.filter((r) => r.provider === "google-news").length, 3);
  assert.equal(rows[0].provider, "bing-news");
});
