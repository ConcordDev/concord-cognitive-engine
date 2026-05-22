// Contract tests for the sports ESPN spectator-core macros:
// play-by-play game summary, schedule/calendar, ESPN standings, news,
// team roster, player lookup, game reminders, single-elimination
// brackets, and the win-probability model. Pairs with
// sports-fan-domain-parity.test.js (fan-hub state macros) and
// sports-space-domain-parity.test.js (scoreboard / TheSportsDB).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSportsActions from "../domains/sports.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`sports.${name}`);
  assert.ok(fn, `sports.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSportsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function mockJson(payload) {
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
}

describe("sports.espn-game-summary (play-by-play)", () => {
  it("rejects unsupported sport / missing event", async () => {
    assert.equal((await call("espn-game-summary", ctxA, { sport: "cricket", eventId: "1" })).ok, false);
    assert.equal((await call("espn-game-summary", ctxA, { sport: "nba" })).ok, false);
  });

  it("parses ESPN summary into teams + scoring plays", async () => {
    mockJson({
      header: { competitions: [{ status: { type: { description: "Final", completed: true } },
        competitors: [
          { team: { displayName: "Lakers", abbreviation: "LAL" }, score: "110", homeAway: "home", winner: true },
          { team: { displayName: "Celtics", abbreviation: "BOS" }, score: "104", homeAway: "away", winner: false },
        ], venue: { fullName: "Crypto.com Arena" } }] },
      scoringPlays: [
        { id: "p1", text: "Three pointer", period: { number: 1 }, scoringPlay: true, scoreValue: 3, homeScore: 3, awayScore: 0, team: { abbreviation: "LAL" } },
      ],
      article: { headline: "Lakers hold off Celtics", story: "A tight one." },
    });
    const r = await call("espn-game-summary", ctxA, { sport: "nba", eventId: "401" });
    assert.equal(r.ok, true);
    assert.equal(r.result.teams[0].team, "Lakers");
    assert.equal(r.result.playCount, 1);
    assert.equal(r.result.plays[0].scoringPlay, true);
    assert.equal(r.result.recap.headline, "Lakers hold off Celtics");
  });
});

describe("sports.espn-schedule (calendar)", () => {
  it("rejects unsupported sport", async () => {
    assert.equal((await call("espn-schedule", ctxA, { sport: "cricket" })).ok, false);
  });

  it("aggregates fixtures across a date range", async () => {
    mockJson({
      events: [{
        id: "e1", shortName: "BOS @ LAL", name: "Celtics at Lakers",
        date: "2026-05-22T03:00Z",
        status: { type: { description: "Scheduled", state: "pre", completed: false } },
        competitions: [{ competitors: [
          { team: { abbreviation: "LAL" }, homeAway: "home" },
          { team: { abbreviation: "BOS" }, homeAway: "away" },
        ], venue: { fullName: "Crypto.com Arena" } }],
      }],
    });
    const r = await call("espn-schedule", ctxA, { sport: "nba", days: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.upcoming >= 1);
    assert.equal(r.result.fixtures[0].home, "LAL");
  });
});

describe("sports.espn-standings", () => {
  it("walks nested standings groups", async () => {
    mockJson({
      children: [{
        name: "Eastern Conference",
        standings: { entries: [{
          team: { displayName: "Celtics", abbreviation: "BOS" },
          stats: [
            { name: "wins", value: 55 }, { name: "losses", value: 27 },
            { name: "winPercent", value: 0.671 },
            { name: "streak", displayValue: "W3" },
          ],
        }] },
      }],
    });
    const r = await call("espn-standings", ctxA, { sport: "nba" });
    assert.equal(r.ok, true);
    assert.equal(r.result.groups[0].name, "Eastern Conference");
    assert.equal(r.result.groups[0].teams[0].wins, 55);
    assert.equal(r.result.groups[0].teams[0].streak, "W3");
  });
});

describe("sports.espn-news", () => {
  it("rejects unsupported sport", async () => {
    assert.equal((await call("espn-news", ctxA, { sport: "cricket" })).ok, false);
  });

  it("shapes ESPN news articles", async () => {
    mockJson({ articles: [{
      headline: "Trade deadline recap", description: "Big moves.",
      published: "2026-05-20T12:00Z", byline: "Staff",
      images: [{ url: "https://img.example/x.jpg" }],
      links: { web: { href: "https://espn.com/story" } },
    }] });
    const r = await call("espn-news", ctxA, { sport: "nba", limit: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.articles[0].headline, "Trade deadline recap");
    assert.equal(r.result.articles[0].link, "https://espn.com/story");
  });
});

describe("sports.team-roster (TheSportsDB)", () => {
  it("rejects missing teamId", async () => {
    assert.equal((await call("team-roster", ctxA, {})).ok, false);
  });

  it("shapes player roster", async () => {
    mockJson({ player: [{
      idPlayer: "p1", strPlayer: "Star Forward", strPosition: "Forward",
      strNationality: "USA", strNumber: "23", strHeight: "6 ft 9 in",
    }] });
    const r = await call("team-roster", ctxA, { teamId: "133604" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.players[0].name, "Star Forward");
    assert.equal(r.result.players[0].number, "23");
  });
});

describe("sports.player-lookup (TheSportsDB)", () => {
  it("rejects missing name", async () => {
    assert.equal((await call("player-lookup", ctxA, {})).ok, false);
  });

  it("shapes player search results", async () => {
    mockJson({ player: [{
      idPlayer: "p9", strPlayer: "LeBron James", strTeam: "Lakers",
      strSport: "Basketball", strPosition: "Forward", strNationality: "USA",
      dateBorn: "1984-12-30",
    }] });
    const r = await call("player-lookup", ctxA, { name: "LeBron" });
    assert.equal(r.ok, true);
    assert.equal(r.result.players[0].name, "LeBron James");
    assert.equal(r.result.players[0].team, "Lakers");
  });
});

describe("sports.reminders", () => {
  it("set, list (upcoming flag), delete", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const set = call("reminder-set", ctxA, { matchup: "Lakers vs Celtics", sport: "nba", kickoff: future });
    assert.equal(set.ok, true);
    const list = call("reminder-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.reminders[0].upcoming, true);
    assert.equal(call("reminder-delete", ctxA, { id: set.result.reminder.id }).ok, true);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 0);
  });

  it("rejects missing matchup, scopes per user", () => {
    assert.equal(call("reminder-set", ctxA, {}).ok, false);
    call("reminder-set", ctxA, { matchup: "A vs B" });
    assert.equal(call("reminder-list", ctxB, {}).result.count, 0);
  });
});

describe("sports.brackets (single elimination)", () => {
  it("create pads to power of two, list, delete", () => {
    const c = call("bracket-create", ctxA, { name: "Playoffs", teams: ["A", "B", "C"] });
    assert.equal(c.ok, true);
    assert.equal(c.result.bracket.size, 4);
    assert.equal(call("bracket-list", ctxA, {}).result.brackets.length, 1);
    assert.equal(call("bracket-delete", ctxA, { id: c.result.bracket.id }).ok, true);
    assert.equal(call("bracket-list", ctxA, {}).result.brackets.length, 0);
  });

  it("rejects too few teams", () => {
    assert.equal(call("bracket-create", ctxA, { name: "X", teams: ["Solo"] }).ok, false);
  });

  it("advance picks winners and crowns a champion", () => {
    const c = call("bracket-create", ctxA, { name: "Cup", teams: ["A", "B", "C", "D"] });
    const b = c.result.bracket;
    const r0 = b.matches.filter((m) => m.round === 0);
    call("bracket-advance", ctxA, { bracketId: b.id, matchId: r0[0].id, winner: r0[0].teamA });
    const adv = call("bracket-advance", ctxA, { bracketId: b.id, matchId: r0[1].id, winner: r0[1].teamA });
    const finals = adv.result.bracket.matches.filter((m) => m.round === 1);
    assert.equal(finals.length, 1);
    const champ = call("bracket-advance", ctxA, { bracketId: b.id, matchId: finals[0].id, winner: finals[0].teamA });
    assert.equal(champ.result.bracket.champion, finals[0].teamA);
  });
});

describe("sports.win-probability (pure-compute)", () => {
  it("favors the leader and increases certainty late", () => {
    const early = call("win-probability", ctxA, { homeScore: 10, awayScore: 4, period: 1, periodsTotal: 4 });
    const late = call("win-probability", ctxA, { homeScore: 10, awayScore: 4, period: 4, periodsTotal: 4, clock: "1:00" });
    assert.equal(early.ok, true);
    assert.equal(early.result.favored, "home");
    assert.ok(late.result.homeWinPct > early.result.homeWinPct);
    assert.equal(late.result.leader, "home");
  });

  it("tied game near 50/50", () => {
    const r = call("win-probability", ctxA, { homeScore: 50, awayScore: 50, period: 1, periodsTotal: 4, homeField: false });
    assert.equal(r.result.leader, "tied");
    assert.ok(Math.abs(r.result.homeWinPct - 50) < 5);
  });
});
