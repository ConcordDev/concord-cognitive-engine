// Contract tests for server/domains/sports.js + server/domains/space.js
// — pure-compute helpers plus real free APIs (TheSportsDB / ESPN /
// SpaceX / Launch Library 2).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSportsActions from "../domains/sports.js";
import registerSpaceActions from "../domains/space.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => {
  registerSportsActions(register);
  registerSpaceActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("sports.team-lookup (TheSportsDB)", () => {
  it("rejects missing name", async () => {
    const r = await call("sports.team-lookup", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("hits TheSportsDB + shapes real response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          teams: [{
            idTeam: "133739", strTeam: "Arsenal", strAlternate: "Gunners",
            strSport: "Soccer", strLeague: "English Premier League", idLeague: "4328",
            strCountry: "England", intFormedYear: "1886",
            strStadium: "Emirates Stadium", intStadiumCapacity: "60704",
            strStadiumLocation: "London", strWebsite: "www.arsenal.com",
            strTeamBadge: "https://example/arsenal.png",
            strDescriptionEN: "Arsenal Football Club is a professional football club...",
          }],
        }),
      };
    };
    const r = await call("sports.team-lookup", ctxA, { name: "Arsenal" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /thesportsdb\.com\/api\/v1\/json\/3\/searchteams/);
    assert.equal(r.result.teams[0].name, "Arsenal");
    assert.equal(r.result.teams[0].formedYear, 1886);
    assert.equal(r.result.source, "thesportsdb");
  });

  it("uses SPORTSDB_API_KEY when set", async () => {
    process.env.SPORTSDB_API_KEY = "real-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ teams: [] }) };
    };
    await call("sports.team-lookup", ctxA, { name: "x" });
    assert.match(capturedUrl, /\/real-key\/searchteams/);
    delete process.env.SPORTSDB_API_KEY;
  });
});

describe("sports.league-table (TheSportsDB)", () => {
  it("rejects missing leagueId", async () => {
    assert.equal((await call("sports.league-table", ctxA, {})).ok, false);
  });

  it("hits TheSportsDB + parses + sorts", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        table: [
          { intRank: "1", idTeam: "133739", strTeam: "Arsenal", intPlayed: "20", intWin: "15", intDraw: "3", intLoss: "2", intGoalsFor: "45", intGoalsAgainst: "15", intGoalDifference: "30", intPoints: "48", strTeamBadge: "x" },
          { intRank: "2", idTeam: "133602", strTeam: "Liverpool", intPlayed: "20", intWin: "14", intDraw: "4", intLoss: "2", intGoalsFor: "42", intGoalsAgainst: "18", intGoalDifference: "24", intPoints: "46", strTeamBadge: "y" },
        ],
      }),
    });
    const r = await call("sports.league-table", ctxA, { leagueId: "4328" });
    assert.equal(r.ok, true);
    assert.equal(r.result.table[0].teamName, "Arsenal");
    assert.equal(r.result.table[0].points, 48);
    assert.equal(r.result.source, "thesportsdb");
  });
});

describe("sports.scoreboard (ESPN public API)", () => {
  it("rejects missing sport", async () => {
    assert.equal((await call("sports.scoreboard", ctxA, {})).ok, false);
  });

  it("rejects unsupported sport", async () => {
    const r = await call("sports.scoreboard", ctxA, { sport: "cricket" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unsupported sport/);
  });

  it("hits ESPN + parses competitor/score response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          events: [{
            id: "401547651", name: "Lakers @ Warriors",
            shortName: "LAL @ GSW", date: "2026-05-16T03:00Z",
            status: { type: { description: "Final", completed: true }, period: 4, displayClock: "0.0" },
            competitions: [{
              competitors: [
                { team: { displayName: "Golden State Warriors", abbreviation: "GSW" }, score: "115", homeAway: "home", winner: true, records: [{ summary: "44-37" }] },
                { team: { displayName: "Los Angeles Lakers", abbreviation: "LAL" }, score: "108", homeAway: "away", winner: false, records: [{ summary: "47-34" }] },
              ],
              venue: { fullName: "Chase Center", address: { city: "San Francisco" } },
            }],
          }],
        }),
      };
    };
    const r = await call("sports.scoreboard", ctxA, { sport: "nba" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/scoreboard/);
    assert.equal(r.result.events[0].teams[0].team, "Golden State Warriors");
    assert.equal(r.result.events[0].teams[0].score, 115);
    assert.equal(r.result.events[0].status, "Final");
    assert.equal(r.result.source, "espn-scoreboard");
  });

  it("supports date param for historical scores", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ events: [] }) };
    };
    await call("sports.scoreboard", ctxA, { sport: "nfl", date: "20240107" });
    assert.match(capturedUrl, /football\/nfl\/scoreboard\?dates=20240107/);
  });
});

describe("space.spacex-upcoming", () => {
  it("hits SpaceX API + parses launches", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          id: "abc123", name: "Crew-9", flight_number: 312,
          date_utc: "2026-06-01T10:00:00.000Z", date_unix: 1748767200, date_precision: "hour",
          rocket: "falcon9-id", launchpad: "kennedy-39a",
          details: "Crew Dragon mission to ISS",
          success: null, upcoming: true,
          links: { patch: { small: "https://images.example.org/patch.png" }, webcast: "https://youtu.be/x", wikipedia: "https://en.wikipedia.org/wiki/Crew-9" },
        }]),
      };
    };
    const r = await call("space.spacex-upcoming", ctxA, { limit: 5 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.spacexdata\.com\/v4\/launches\/upcoming/);
    assert.equal(r.result.launches[0].name, "Crew-9");
    assert.equal(r.result.launches[0].flightNumber, 312);
    assert.equal(r.result.source, "spacexdata-api");
  });
});

describe("space.launch-library-upcoming", () => {
  it("hits Launch Library 2 + parses cross-provider list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          count: 50,
          results: [{
            id: "uuid-1", name: "Falcon 9 | Starlink 6-67",
            net: "2026-06-15T08:30:00Z",
            window_start: "2026-06-15T08:30:00Z", window_end: "2026-06-15T12:30:00Z",
            status: { name: "Go for Launch" },
            launch_service_provider: { name: "SpaceX" },
            rocket: { configuration: { full_name: "Falcon 9 Block 5" } },
            mission: { name: "Starlink 6-67", description: "Starlink batch deployment", type: "Communications", orbit: { name: "Low Earth Orbit" } },
            pad: { name: "Space Launch Complex 40", location: { name: "Cape Canaveral SFS, FL, USA" }, country_code: "USA" },
            webcast_live: false,
            image: "https://example.org/launch.jpg",
          }],
        }),
      };
    };
    const r = await call("space.launch-library-upcoming", ctxA, { limit: 5 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /ll\.thespacedevs\.com\/2\.2\.0\/launch\/upcoming/);
    assert.equal(r.result.launches[0].provider, "SpaceX");
    assert.equal(r.result.launches[0].rocket, "Falcon 9 Block 5");
    assert.equal(r.result.totalAvailable, 50);
    assert.equal(r.result.source, "thespacedevs-launch-library");
  });

  it("surfaces 429 rate limit clearly", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("space.launch-library-upcoming", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit exceeded/);
  });
});

describe("space.orbitCalc (existing pure-math)", () => {
  it("computes LEO at 400 km", () => {
    const r = call("space.orbitCalc", ctxA, { data: { altitudeKm: 400 } }, {});
    assert.equal(r.ok, true);
    // ISS orbital period ≈ 92 min
    assert.ok(r.result.periodMinutes > 90 && r.result.periodMinutes < 95);
    assert.equal(r.result.type, "LEO");
  });
});
