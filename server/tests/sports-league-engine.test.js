// Contract test for the sports-league-engine Phase II Wave 17 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  openLeague, addTeam, addRosterMember, listTeamsInLeague,
  ensureCareer, requestTryout,
  scheduleMatch, playMatch, tickLeagues,
  advanceCareerStage, recordMatchOutcome, retireCareer,
  SPORTS_CONSTANTS,
} from "../lib/sports-league-engine.js";
import registerSportsMacros from "../domains/sports-careers.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`sports_careers.${name}`);
  assert.ok(fn, `sports_careers.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerSportsMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sports_leagues (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sport_kind TEXT NOT NULL,
      season_num INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      next_match_at INTEGER
    );
    CREATE TABLE sports_teams (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      name TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      power_score REAL NOT NULL DEFAULT 50
    );
    CREATE TABLE sports_rosters (
      team_id TEXT NOT NULL,
      member_kind TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'roster',
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at INTEGER,
      PRIMARY KEY (team_id, member_kind, member_id)
    );
    CREATE TABLE sports_matches (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      scheduled_at INTEGER NOT NULL,
      played_at INTEGER,
      status TEXT NOT NULL DEFAULT 'scheduled'
    );
    CREATE TABLE sports_careers (
      id TEXT PRIMARY KEY,
      player_user_id TEXT NOT NULL,
      sport_kind TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'amateur',
      tryouts_attempted INTEGER NOT NULL DEFAULT 0,
      tryouts_passed INTEGER NOT NULL DEFAULT 0,
      matches_played INTEGER NOT NULL DEFAULT 0,
      total_score INTEGER NOT NULL DEFAULT 0,
      mvp_awards INTEGER NOT NULL DEFAULT 0,
      retired_at INTEGER,
      started_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX idx_sports_careers_player_sport ON sports_careers (player_user_id, sport_kind);
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });

describe("sports-league-engine library", () => {
  it("openLeague + addTeam + listTeams", () => {
    const lg = openLeague(db, { worldId: "w1", name: "NBA", sportKind: "basketball" });
    addTeam(db, lg.leagueId, "Lakers", 80);
    addTeam(db, lg.leagueId, "Knicks", 50);
    const teams = listTeamsInLeague(db, lg.leagueId);
    assert.equal(teams.length, 2);
    assert.equal(teams[0].name, "Lakers");
  });

  it("requestTryout pass/fail by stage threshold", () => {
    const lg = openLeague(db, { worldId: "w1", name: "NBA", sportKind: "basketball" });
    // amateur stage requires composite >= 30; (athleticSkill 25 + reflexSkill 35) / 2 = 30
    const r = requestTryout(db, "alice", lg.leagueId, { athleticSkill: 25, reflexSkill: 35 });
    assert.equal(r.passed, true);
    const fail = requestTryout(db, "alice", lg.leagueId, { athleticSkill: 10, reflexSkill: 20 });
    assert.equal(fail.passed, false);
    const career = db.prepare("SELECT * FROM sports_careers WHERE player_user_id = ?").get("alice");
    assert.equal(career.tryouts_attempted, 2);
    assert.equal(career.tryouts_passed, 1);
  });

  it("scheduleMatch + playMatch home favored deterministic roll", () => {
    const lg = openLeague(db, { worldId: "w1", name: "x", sportKind: "basketball" });
    const home = addTeam(db, lg.leagueId, "Home", 90);
    const away = addTeam(db, lg.leagueId, "Away", 30);
    const m = scheduleMatch(db, lg.leagueId, home.teamId, away.teamId, Math.floor(Date.now() / 1000) - 60);
    const r = playMatch(db, m.matchId, { rollOverride: 0.1 }); // low roll → home win
    assert.equal(r.ok, true);
    assert.equal(r.homeWon, true);
    assert.ok(r.homeScore > r.awayScore);
    const home2 = db.prepare("SELECT * FROM sports_teams WHERE id = ?").get(home.teamId);
    assert.equal(home2.wins, 1);
  });

  it("playMatch underdog upset (high roll favors away)", () => {
    const lg = openLeague(db, { worldId: "w1", name: "x", sportKind: "soccer" });
    const home = addTeam(db, lg.leagueId, "Home", 90);
    const away = addTeam(db, lg.leagueId, "Away", 30);
    const m = scheduleMatch(db, lg.leagueId, home.teamId, away.teamId, Math.floor(Date.now() / 1000) - 60);
    const r = playMatch(db, m.matchId, { rollOverride: 0.99 });
    assert.equal(r.homeWon, false);
  });

  it("playMatch rejects double-play", () => {
    const lg = openLeague(db, { worldId: "w1", name: "x", sportKind: "basketball" });
    const a = addTeam(db, lg.leagueId, "A", 50);
    const b = addTeam(db, lg.leagueId, "B", 50);
    const m = scheduleMatch(db, lg.leagueId, a.teamId, b.teamId, Math.floor(Date.now() / 1000));
    playMatch(db, m.matchId, { rollOverride: 0.5 });
    const second = playMatch(db, m.matchId, { rollOverride: 0.5 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_played");
  });

  it("tickLeagues plays all due matches", () => {
    const lg = openLeague(db, { worldId: "w1", name: "x", sportKind: "basketball" });
    const a = addTeam(db, lg.leagueId, "A", 50);
    const b = addTeam(db, lg.leagueId, "B", 50);
    scheduleMatch(db, lg.leagueId, a.teamId, b.teamId, Math.floor(Date.now() / 1000) - 60);
    scheduleMatch(db, lg.leagueId, a.teamId, b.teamId, Math.floor(Date.now() / 1000) - 30);
    const r = tickLeagues(db);
    assert.equal(r.played, 2);
  });

  it("advanceCareerStage requires thresholds", () => {
    const career = ensureCareer(db, "alice", "basketball");
    const before = advanceCareerStage(db, career.id);
    assert.equal(before.ok, false);
    // Update to meet semi_pro thresholds
    db.prepare(`
      UPDATE sports_careers SET matches_played = 10, total_score = 100, mvp_awards = 1 WHERE id = ?
    `).run(career.id);
    const after = advanceCareerStage(db, career.id);
    assert.equal(after.stage, "semi_pro");
  });

  it("recordMatchOutcome accumulates stats", () => {
    const career = ensureCareer(db, "alice", "basketball");
    recordMatchOutcome(db, career.id, 30, true);
    recordMatchOutcome(db, career.id, 24, false);
    const updated = db.prepare("SELECT * FROM sports_careers WHERE id = ?").get(career.id);
    assert.equal(updated.matches_played, 2);
    assert.equal(updated.total_score, 54);
    assert.equal(updated.mvp_awards, 1);
  });

  it("retireCareer flips retired_at", () => {
    const career = ensureCareer(db, "alice", "basketball");
    const r = retireCareer(db, career.id);
    assert.equal(r.ok, true);
    const second = retireCareer(db, career.id);
    assert.equal(second.ok, false);
  });

  it("addRosterMember rejects double-insert via UNIQUE", () => {
    const lg = openLeague(db, { worldId: "w1", name: "x", sportKind: "basketball" });
    const t = addTeam(db, lg.leagueId, "Lakers", 50);
    const a = addRosterMember(db, t.teamId, "player", "alice", "starter");
    assert.equal(a.ok, true);
    const b = addRosterMember(db, t.teamId, "player", "alice", "starter");
    assert.equal(b.alreadyOnRoster, true);
  });

  it("constants exposed", () => {
    assert.ok(SPORTS_CONSTANTS.STAGE_THRESHOLDS.legend.matches > 0);
  });
});

describe("sports domain macros", () => {
  it("end-to-end open → team → tryout → schedule → play → record", async () => {
    const lg = await call("open_league", ctxAlice(), { worldId: "w1", name: "NBA", sportKind: "basketball" });
    const a = await call("add_team", ctxAlice(), { leagueId: lg.leagueId, name: "Lakers", powerScore: 80 });
    const b = await call("add_team", ctxAlice(), { leagueId: lg.leagueId, name: "Knicks", powerScore: 40 });
    const tryout = await call("request_tryout", ctxAlice(), { leagueId: lg.leagueId, athleticSkill: 80, reflexSkill: 80 });
    assert.equal(tryout.passed, true);
    const match = await call("schedule_match", ctxAlice(), {
      leagueId: lg.leagueId, homeTeamId: a.teamId, awayTeamId: b.teamId,
      scheduledAt: Math.floor(Date.now() / 1000) - 1,
    });
    const r = await call("play_match", ctxAlice(), { matchId: match.matchId, rollOverride: 0.1 });
    assert.equal(r.homeWon, true);
  });

  it("rejects no_user on request_tryout", async () => {
    const r = await call("request_tryout", { actor: { userId: null }, userId: null, db }, { leagueId: "x" });
    assert.equal(r.ok, false);
  });
});
