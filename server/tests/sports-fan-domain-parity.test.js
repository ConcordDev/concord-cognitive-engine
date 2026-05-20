// Contract tests for the sports ESPN 2026-parity fan-hub macros
// (teams, games, predictions, standings, athletes). ESPN-API +
// compute macros are covered in sports-space-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSportsActions from "../domains/sports.js";

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
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newGame(ctx = ctxA, over = {}) {
  return call("game-add", ctx, { homeTeam: "Lakers", awayTeam: "Celtics", league: "nba", ...over }).result.game;
}

describe("sports.team-follow", () => {
  it("toggles follow, scoped per user", () => {
    assert.equal(call("team-follow", ctxA, { name: "Lakers", league: "nba" }).result.following, true);
    assert.equal(call("team-list", ctxA, {}).result.teams.length, 1);
    assert.equal(call("team-list", ctxB, {}).result.teams.length, 0);
    assert.equal(call("team-follow", ctxA, { name: "Lakers", league: "nba" }).result.following, false);
  });

  it("news attaches to a team", () => {
    call("team-news-add", ctxA, { team: "Lakers", headline: "Big trade" });
    assert.equal(call("team-news-list", ctxA, { team: "Lakers" }).result.count, 1);
    assert.equal(call("team-news-add", ctxA, { team: "Lakers" }).ok, false);
  });
});

describe("sports.game-* tracking", () => {
  it("add, score update, winner computed on final", () => {
    const g = newGame();
    assert.equal(g.winner, null);
    const upd = call("game-update-score", ctxA, { id: g.id, homeScore: 110, awayScore: 102, status: "final" });
    assert.equal(upd.result.game.winner, "Lakers");
  });

  it("list filters by status", () => {
    newGame(ctxA, { status: "live" });
    newGame(ctxA, { status: "scheduled" });
    assert.equal(call("game-list", ctxA, { status: "live" }).result.count, 1);
    assert.equal(call("game-list", ctxA, {}).result.count, 2);
  });
});

describe("sports.predictions (Pick'em)", () => {
  it("predict, resolve correct after final, accuracy", () => {
    const g = newGame();
    assert.equal(call("prediction-make", ctxA, { gameId: g.id, predictedWinner: "Bulls" }).ok, false);
    call("prediction-make", ctxA, { gameId: g.id, predictedWinner: "Lakers" });
    assert.equal(call("prediction-list", ctxA, {}).result.predictions[0].outcome, "pending");
    call("game-update-score", ctxA, { id: g.id, homeScore: 100, awayScore: 90, status: "final" });
    assert.equal(call("prediction-list", ctxA, {}).result.predictions[0].outcome, "correct");
    const rec = call("prediction-record", ctxA, {});
    assert.equal(rec.result.correct, 1);
    assert.equal(rec.result.accuracy, 100);
  });
});

describe("sports.watchlist", () => {
  it("add, list, remove", () => {
    const g = newGame(ctxA, { status: "scheduled" });
    call("watchlist-add", ctxA, { gameId: g.id });
    assert.equal(call("watchlist-list", ctxA, {}).result.count, 1);
    call("watchlist-remove", ctxA, { gameId: g.id });
    assert.equal(call("watchlist-list", ctxA, {}).result.count, 0);
  });
});

describe("sports.standings", () => {
  it("set records and rank by win pct", () => {
    call("standing-set", ctxA, { team: "Lakers", league: "nba", wins: 50, losses: 20 });
    call("standing-set", ctxA, { team: "Celtics", league: "nba", wins: 55, losses: 15 });
    const table = call("standings-table", ctxA, { league: "nba" });
    assert.equal(table.result.table[0].team, "Celtics");
    assert.equal(table.result.table[0].rank, 1);
  });
});

describe("sports.athletes", () => {
  it("track athlete, log stats, totals + averages", () => {
    const ath = call("athlete-track", ctxA, { name: "Star Player", team: "Lakers", position: "PG" }).result.athlete;
    call("athlete-stat-log", ctxA, { athleteId: ath.id, stats: { points: 30, assists: 8 } });
    call("athlete-stat-log", ctxA, { athleteId: ath.id, stats: { points: 20, assists: 12 } });
    const stats = call("athlete-stats", ctxA, { athleteId: ath.id });
    assert.equal(stats.result.games, 2);
    assert.equal(stats.result.totals.points, 50);
    assert.equal(stats.result.averages.assists, 10);
  });

  it("rejects stats for a missing athlete", () => {
    assert.equal(call("athlete-stat-log", ctxA, { athleteId: "nope", stats: {} }).ok, false);
  });
});

describe("sports.my-scores + dashboard", () => {
  it("my-scores filters to followed teams", () => {
    call("team-follow", ctxA, { name: "Lakers", league: "nba" });
    newGame(ctxA, { homeTeam: "Lakers", awayTeam: "Heat" });
    newGame(ctxA, { homeTeam: "Bulls", awayTeam: "Nets" });
    const ms = call("my-scores", ctxA, {});
    assert.equal(ms.result.games.length, 1);
    assert.equal(ms.result.games[0].homeTeam, "Lakers");
  });

  it("dashboard aggregates", () => {
    call("team-follow", ctxA, { name: "Lakers", league: "nba" });
    newGame(ctxA, { status: "live" });
    const d = call("sports-dashboard", ctxA, {});
    assert.equal(d.result.followedTeams, 1);
    assert.equal(d.result.liveGames, 1);
  });
});
