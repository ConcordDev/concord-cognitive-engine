// Phase Z10 — DC1 sports engine integration test.
//
// End-to-end: open league → add 4 teams → schedule match → play match
// → verify scores landed in DB + standings updated.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upSports } from "../../migrations/211_sports_leagues.js";
import {
  openLeague,
  addTeam,
  scheduleMatch,
  playMatch,
  listTeamsInLeague,
} from "../../lib/sports-league-engine.js";

function bootDb() {
  const db = new Database(":memory:");
  upSports(db);
  return db;
}

describe("Phase Z10 / DC1 — sports engine end-to-end", () => {
  it("opens a league, adds 4 teams, schedules + plays a match, updates standings", () => {
    const db = bootDb();

    const lg = openLeague(db, { worldId: "concordia-hub", name: "Test League", sportKind: "soccer" });
    assert.equal(lg.ok, true);
    assert.ok(lg.leagueId);

    const t1 = addTeam(db, lg.leagueId, "Alpha", 60);
    const t2 = addTeam(db, lg.leagueId, "Beta", 50);
    const t3 = addTeam(db, lg.leagueId, "Gamma", 70);
    const t4 = addTeam(db, lg.leagueId, "Delta", 40);
    assert.equal(t1.ok, true);
    assert.equal(t2.ok, true);

    let teams = listTeamsInLeague(db, lg.leagueId);
    assert.equal(teams.length, 4);
    // power_score range check.
    for (const t of teams) {
      assert.ok(t.power_score >= 0 && t.power_score <= 100);
      assert.equal(t.wins, 0);
      assert.equal(t.losses, 0);
    }

    const match = scheduleMatch(db, lg.leagueId, t1.teamId, t2.teamId, Math.floor(Date.now() / 1000));
    assert.equal(match.ok, true);
    assert.ok(match.matchId);

    const result = playMatch(db, match.matchId);
    assert.equal(result.ok, true);
    assert.ok(typeof result.homeScore === "number");
    assert.ok(typeof result.awayScore === "number");
    assert.ok(result.homeScore >= 0);
    assert.ok(result.awayScore >= 0);

    // Standings should have updated for the two playing teams.
    teams = listTeamsInLeague(db, lg.leagueId);
    const alpha = teams.find((t) => t.id === t1.teamId);
    const beta = teams.find((t) => t.id === t2.teamId);
    const totalGames = (alpha.wins + alpha.losses + alpha.draws) + (beta.wins + beta.losses + beta.draws);
    assert.ok(totalGames === 2, `expected 2 total game-rows updated, got ${totalGames}`);

    // Untouched teams should still be at 0.
    const gamma = teams.find((t) => t.id === t3.teamId);
    const delta = teams.find((t) => t.id === t4.teamId);
    assert.equal(gamma.wins + gamma.losses + gamma.draws, 0);
    assert.equal(delta.wins + delta.losses + delta.draws, 0);
  });

  it("rejects an openLeague with missing inputs", () => {
    const db = bootDb();
    const r = openLeague(db, { worldId: null, name: "X", sportKind: "soccer" });
    assert.equal(r.ok, false);
  });

  it("power_score is bounded to [0, 100]", () => {
    const db = bootDb();
    const lg = openLeague(db, { worldId: "w", name: "L", sportKind: "soccer" });
    const high = addTeam(db, lg.leagueId, "Sky", 200);
    const low = addTeam(db, lg.leagueId, "Pit", -50);
    const teams = listTeamsInLeague(db, lg.leagueId);
    const sky = teams.find((t) => t.id === high.teamId);
    const pit = teams.find((t) => t.id === low.teamId);
    assert.equal(sky.power_score, 100);
    assert.equal(pit.power_score, 0);
  });
});
