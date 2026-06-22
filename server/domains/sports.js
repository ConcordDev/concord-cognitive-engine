// server/domains/sports.js
//
// Pure-compute helpers (performance stats, training plan, injury risk,
// team analysis) plus real free APIs (TheSportsDB for team / league /
// fixture lookups, ESPN scoreboard for live scores).
//
// TheSportsDB free dev key "3"; production may set SPORTSDB_API_KEY.
// ESPN's public scoreboard endpoint is unkeyed (rate-limited).

import { cachedFetchJson } from "../lib/external-fetch.js";

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";

// ESPN sport-slug → API path. Shared by scoreboard, schedule, news,
// game-summary, standings, roster macros.
const ESPN_SPORT_PATH = {
  nba:   "basketball/nba",
  wnba:  "basketball/wnba",
  ncaab: "basketball/mens-college-basketball",
  ncaaf: "football/college-football",
  nfl:   "football/nfl",
  mlb:   "baseball/mlb",
  nhl:   "hockey/nhl",
};
function espnPathFor(sport, league) {
  const k = String(sport || "").toLowerCase().trim();
  if (k === "soccer") return `soccer/${league || "eng.1"}`;
  return ESPN_SPORT_PATH[k] || null;
}

export default function registerSportsActions(registerLensAction) {
  registerLensAction("sports", "performanceStats", (ctx, artifact, _params) => { const stats = artifact.data?.stats || []; if (stats.length === 0) return { ok: true, result: { message: "Add performance statistics to analyze." } }; const values = stats.map(s => parseFloat(s.value) || 0); const avg = values.reduce((s,v)=>s+v,0)/values.length; const best = Math.max(...values); const worst = Math.min(...values); const recent5 = values.slice(-5); const trend = recent5.length >= 2 ? (recent5[recent5.length-1] > recent5[0] ? "improving" : "declining") : "insufficient"; return { ok: true, result: { metric: stats[0]?.metric || "performance", average: Math.round(avg*100)/100, best, worst, trend, recentAvg: Math.round(recent5.reduce((s,v)=>s+v,0)/recent5.length*100)/100, consistency: Math.round(Math.sqrt(values.reduce((s,v)=>s+Math.pow(v-avg,2),0)/values.length)*100)/100, dataPoints: values.length } }; });
  registerLensAction("sports", "trainingPlan", (ctx, artifact, _params) => { const data = artifact.data || {}; const sport = (data.sport || "general").toLowerCase(); const level = (data.level || "intermediate").toLowerCase(); const daysPerWeek = parseInt(data.daysPerWeek) || 4; const plans = { running: ["Easy run", "Tempo run", "Intervals", "Long run", "Rest", "Cross-train", "Easy run"], swimming: ["Technique drills", "Speed sets", "Endurance", "Recovery", "Rest", "Open water", "Drills"], cycling: ["Base ride", "Hill repeats", "Tempo", "Long ride", "Rest", "Recovery spin", "Group ride"], general: ["Strength", "Cardio", "HIIT", "Active recovery", "Rest", "Flexibility", "Sport-specific"] }; const template = plans[sport] || plans.general; const schedule = template.slice(0, daysPerWeek).map((workout, i) => ({ day: i+1, workout, intensity: workout.includes("Rest") || workout.includes("Recovery") ? "low" : workout.includes("HIIT") || workout.includes("Interval") ? "high" : "moderate" })); return { ok: true, result: { sport, level, daysPerWeek, schedule, weeklyStructure: { hard: schedule.filter(s => s.intensity === "high").length, moderate: schedule.filter(s => s.intensity === "moderate").length, easy: schedule.filter(s => s.intensity === "low").length }, principle: "Follow 80/20 rule: 80% easy, 20% hard" } }; });
  registerLensAction("sports", "injuryRisk", (ctx, artifact, _params) => { const data = artifact.data || {}; const trainingLoad = parseFloat(data.weeklyHours) || 0; const _rd = parseInt(data.restDaysPerWeek); const restDays = Number.isFinite(_rd) ? _rd : 2; const previousInjuries = parseInt(data.previousInjuries) || 0; const age = parseInt(data.age) || 25; const sleep = parseFloat(data.sleepHours) || 7; let risk = 20; if (trainingLoad > 15) risk += 20; if (restDays < 1) risk += 25; if (previousInjuries > 2) risk += 15; if (age > 40) risk += 10; if (sleep < 6) risk += 15; risk = Math.min(100, risk); return { ok: true, result: { riskScore: risk, riskLevel: risk >= 60 ? "high" : risk >= 35 ? "moderate" : "low", factors: { trainingLoad, restDays, previousInjuries, age, sleepHours: sleep }, recommendations: risk >= 40 ? [restDays < 2 ? "Add rest days" : null, sleep < 7 ? "Prioritize 7-9 hours sleep" : null, trainingLoad > 12 ? "Reduce training volume 10-20%" : null, "Include proper warm-up and cool-down"].filter(Boolean) : ["Continue current training — risk is manageable"] } }; });
  registerLensAction("sports", "teamAnalysis", (ctx, artifact, _params) => { const players = artifact.data?.players || []; if (players.length === 0) return { ok: true, result: { message: "Add players with stats to analyze team." } }; const avgAge = Math.round(players.reduce((s,p) => s + (parseInt(p.age) || 25), 0) / players.length * 10) / 10; const positions = {}; for (const p of players) { const pos = p.position || "utility"; positions[pos] = (positions[pos] || 0) + 1; } const avgRating = Math.round(players.reduce((s,p) => s + (parseFloat(p.rating) || 50), 0) / players.length * 10) / 10; return { ok: true, result: { rosterSize: players.length, avgAge, avgRating, positions, topPerformer: players.sort((a,b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))[0]?.name, teamStrength: avgRating >= 70 ? "elite" : avgRating >= 50 ? "competitive" : "developing" } }; });

  // ── Real-data macros (TheSportsDB + ESPN scoreboard) ──

  /**
   * team-lookup — TheSportsDB team search. Free dev tier (key "3"),
   * SPORTSDB_API_KEY env for production.
   * params: { name: string }
   */
  registerLensAction("sports", "team-lookup", async (_ctx, _artifact, params = {}) => {
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const apiKey = process.env.SPORTSDB_API_KEY || "3";
    try {
      const r = await fetch(`${SPORTSDB_BASE}/${encodeURIComponent(apiKey)}/searchteams.php?t=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`thesportsdb ${r.status}`);
      const data = await r.json();
      const teams = (data.teams || []).map((t) => ({
        id: t.idTeam,
        name: t.strTeam,
        alternateName: t.strAlternate,
        sport: t.strSport,
        league: t.strLeague,
        leagueId: t.idLeague,
        country: t.strCountry,
        formedYear: t.intFormedYear ? parseInt(t.intFormedYear, 10) : null,
        stadium: t.strStadium,
        stadiumCapacity: t.intStadiumCapacity ? parseInt(t.intStadiumCapacity, 10) : null,
        stadiumLocation: t.strStadiumLocation,
        website: t.strWebsite,
        badge: t.strTeamBadge,
        logo: t.strTeamLogo,
        description: t.strDescriptionEN,
      }));
      return {
        ok: true,
        result: { teams, count: teams.length, query: name, source: "thesportsdb" },
      };
    } catch (e) {
      return { ok: false, error: `thesportsdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * league-table — TheSportsDB league standings (current season).
   * params: { leagueId: string, season?: "YYYY-YYYY" }
   */
  registerLensAction("sports", "league-table", async (_ctx, _artifact, params = {}) => {
    const leagueId = String(params.leagueId || "").trim();
    if (!leagueId) return { ok: false, error: "leagueId required (TheSportsDB league ID, e.g. '4328' for EPL)" };
    const apiKey = process.env.SPORTSDB_API_KEY || "3";
    const season = params.season ? `&s=${encodeURIComponent(String(params.season))}` : "";
    try {
      const r = await fetch(`${SPORTSDB_BASE}/${encodeURIComponent(apiKey)}/lookuptable.php?l=${encodeURIComponent(leagueId)}${season}`);
      if (!r.ok) throw new Error(`thesportsdb ${r.status}`);
      const data = await r.json();
      const table = (data.table || []).map((row) => ({
        rank: parseInt(row.intRank, 10),
        teamId: row.idTeam,
        teamName: row.strTeam,
        played: parseInt(row.intPlayed, 10),
        win: parseInt(row.intWin, 10),
        draw: parseInt(row.intDraw, 10),
        loss: parseInt(row.intLoss, 10),
        goalsFor: parseInt(row.intGoalsFor, 10),
        goalsAgainst: parseInt(row.intGoalsAgainst, 10),
        goalDifference: parseInt(row.intGoalDifference, 10),
        points: parseInt(row.intPoints, 10),
        badge: row.strTeamBadge,
      }));
      return {
        ok: true,
        result: { table, leagueId, season: params.season || "current", source: "thesportsdb" },
      };
    } catch (e) {
      return { ok: false, error: `thesportsdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * scoreboard — ESPN public scoreboard endpoint. No API key required.
   * params: { sport: nba|nfl|mlb|nhl|soccer, league?: leagueSlug, date?: YYYYMMDD }
   */
  registerLensAction("sports", "scoreboard", async (_ctx, _artifact, params = {}) => {
    const sport = String(params.sport || "").toLowerCase().trim();
    if (!sport) return { ok: false, error: "sport required (e.g. 'nba', 'nfl', 'mlb', 'nhl', 'soccer')" };
    const SPORT_TO_PATH = {
      nba:   "basketball/nba",
      wnba:  "basketball/wnba",
      ncaab: "basketball/mens-college-basketball",
      nfl:   "football/nfl",
      mlb:   "baseball/mlb",
      nhl:   "hockey/nhl",
      soccer: params.league ? `soccer/${params.league}` : "soccer/eng.1",
    };
    const path = SPORT_TO_PATH[sport];
    if (!path) return { ok: false, error: `unsupported sport: ${sport} (try: ${Object.keys(SPORT_TO_PATH).join(", ")})` };
    const date = params.date && /^\d{8}$/.test(String(params.date)) ? `?dates=${params.date}` : "";
    try {
      const r = await fetch(`${ESPN_SCOREBOARD}/${path}/scoreboard${date}`);
      if (!r.ok) throw new Error(`espn ${r.status}`);
      const data = await r.json();
      const events = (data.events || []).map((ev) => {
        const competition = ev.competitions?.[0] || {};
        const teams = (competition.competitors || []).map((c) => ({
          team: c.team?.displayName,
          abbrev: c.team?.abbreviation,
          score: c.score ? parseInt(c.score, 10) : null,
          homeAway: c.homeAway,
          winner: c.winner,
          record: c.records?.[0]?.summary,
        }));
        return {
          id: ev.id,
          name: ev.name,
          shortName: ev.shortName,
          date: ev.date,
          status: ev.status?.type?.description,
          completed: ev.status?.type?.completed,
          period: ev.status?.period,
          clock: ev.status?.displayClock,
          teams,
          venue: competition.venue?.fullName,
          venueCity: competition.venue?.address?.city,
        };
      });
      return {
        ok: true,
        result: { events, eventCount: events.length, sport, path, date: params.date || "today", source: "espn-scoreboard" },
      };
    } catch (e) {
      return { ok: false, error: `espn unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── ESPN 2026 parity — sports fan hub ──────────────────────────────
  // Followed teams, game tracking, Pick'em predictions, standings,
  // tracked athletes + stats, news, personalized scores feed.

  function getSportsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.sportsLens) STATE.sportsLens = {};
    const s = STATE.sportsLens;
    for (const k of [
      "teams", "teamNews", "games", "predictions", "watchlist",
      "standings", "athletes", "athleteStats",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveSportsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const spId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const spNow = () => new Date().toISOString();
  const spAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const spListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const spNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const spClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const spDay = (v) => spClean(v, 10).slice(0, 10);
  const findGame = (s, userId, id) => (s.games.get(userId) || []).find((g) => g.id === id) || null;
  const findAthlete = (s, userId, id) => (s.athletes.get(userId) || []).find((a) => a.id === id) || null;

  function gameWinner(g) {
    if (g.status !== "final") return null;
    if (g.homeScore > g.awayScore) return g.homeTeam;
    if (g.awayScore > g.homeScore) return g.awayTeam;
    return "tie";
  }

  // ── Followed teams ──────────────────────────────────────────────────
  registerLensAction("sports", "team-follow", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = spClean(params.name, 80);
    if (!name) return { ok: false, error: "team name required" };
    const league = spClean(params.league, 40).toLowerCase() || "general";
    const userId = spAid(ctx);
    const teams = spListB(s.teams, userId);
    const existing = teams.find((t) => t.name === name && t.league === league);
    if (existing) {
      teams.splice(teams.indexOf(existing), 1);
      saveSportsState();
      return { ok: true, result: { name, league, following: false } };
    }
    teams.push({ id: spId("tm"), name, league, createdAt: spNow() });
    saveSportsState();
    return { ok: true, result: { name, league, following: true } };
  });

  registerLensAction("sports", "team-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { teams: s.teams.get(spAid(ctx)) || [] } };
  });

  registerLensAction("sports", "team-news-add", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const team = spClean(params.team, 80);
    const headline = spClean(params.headline, 240);
    if (!team || !headline) return { ok: false, error: "team and headline required" };
    const item = {
      id: spId("nws"), team, headline,
      summary: spClean(params.summary, 800) || null,
      source: spClean(params.source, 80) || null,
      date: spDay(params.date) || spDay(spNow()),
      createdAt: spNow(),
    };
    spListB(s.teamNews, spAid(ctx)).push(item);
    saveSportsState();
    return { ok: true, result: { news: item } };
  });

  registerLensAction("sports", "team-news-list", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    // Reverse the insertion-ordered list first: when two items share a
    // millisecond-precision createdAt (rapid back-to-back adds), the stable
    // sort below would otherwise keep insertion order (oldest-first) for the
    // tie. Reversing makes the newest-inserted win ties — deterministic
    // newest-first ordering regardless of timestamp collisions.
    let news = [...(s.teamNews.get(spAid(ctx)) || [])].reverse();
    if (params.team) news = news.filter((n) => n.team === params.team);
    news.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { news, count: news.length } };
  });

  // ── Games ───────────────────────────────────────────────────────────
  registerLensAction("sports", "game-add", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const homeTeam = spClean(params.homeTeam, 80);
    const awayTeam = spClean(params.awayTeam, 80);
    if (!homeTeam || !awayTeam) return { ok: false, error: "homeTeam and awayTeam required" };
    const game = {
      id: spId("gm"), homeTeam, awayTeam,
      league: spClean(params.league, 40).toLowerCase() || "general",
      date: spDay(params.date) || spDay(spNow()),
      homeScore: Math.max(0, Math.round(spNum(params.homeScore))),
      awayScore: Math.max(0, Math.round(spNum(params.awayScore))),
      status: ["scheduled", "live", "final"].includes(String(params.status).toLowerCase())
        ? String(params.status).toLowerCase() : "scheduled",
      createdAt: spNow(),
    };
    spListB(s.games, spAid(ctx)).push(game);
    saveSportsState();
    return { ok: true, result: { game: { ...game, winner: gameWinner(game) } } };
  });

  registerLensAction("sports", "game-list", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let games = [...(s.games.get(spAid(ctx)) || [])];
    if (params.status) games = games.filter((g) => g.status === String(params.status).toLowerCase());
    if (params.league) games = games.filter((g) => g.league === String(params.league).toLowerCase());
    games.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ok: true, result: { games: games.map((g) => ({ ...g, winner: gameWinner(g) })), count: games.length } };
  });

  registerLensAction("sports", "game-update-score", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const game = findGame(s, spAid(ctx), params.id);
    if (!game) return { ok: false, error: "game not found" };
    if (params.homeScore != null) game.homeScore = Math.max(0, Math.round(spNum(params.homeScore)));
    if (params.awayScore != null) game.awayScore = Math.max(0, Math.round(spNum(params.awayScore)));
    if (params.status != null && ["scheduled", "live", "final"].includes(String(params.status).toLowerCase())) {
      game.status = String(params.status).toLowerCase();
    }
    saveSportsState();
    return { ok: true, result: { game: { ...game, winner: gameWinner(game) } } };
  });

  registerLensAction("sports", "game-detail", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const game = findGame(s, userId, params.id);
    if (!game) return { ok: false, error: "game not found" };
    const predictions = (s.predictions.get(userId) || []).filter((p) => p.gameId === game.id);
    return { ok: true, result: { game: { ...game, winner: gameWinner(game) }, predictions } };
  });

  registerLensAction("sports", "game-delete", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.games.get(spAid(ctx)) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "game not found" };
    arr.splice(i, 1);
    saveSportsState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Predictions (Pick'em) ───────────────────────────────────────────
  registerLensAction("sports", "prediction-make", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const game = findGame(s, userId, params.gameId);
    if (!game) return { ok: false, error: "game not found" };
    const predictedWinner = spClean(params.predictedWinner, 80);
    if (predictedWinner !== game.homeTeam && predictedWinner !== game.awayTeam) {
      return { ok: false, error: "predictedWinner must be one of the two teams" };
    }
    const preds = spListB(s.predictions, userId);
    let pred = preds.find((p) => p.gameId === game.id);
    if (pred) {
      pred.predictedWinner = predictedWinner;
      pred.updatedAt = spNow();
    } else {
      pred = { id: spId("prd"), gameId: game.id, predictedWinner, createdAt: spNow() };
      preds.push(pred);
    }
    saveSportsState();
    return { ok: true, result: { prediction: pred } };
  });

  registerLensAction("sports", "prediction-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const games = new Map((s.games.get(userId) || []).map((g) => [g.id, g]));
    const predictions = (s.predictions.get(userId) || []).map((p) => {
      const g = games.get(p.gameId);
      const winner = g ? gameWinner(g) : null;
      return {
        ...p,
        matchup: g ? `${g.awayTeam} @ ${g.homeTeam}` : "(removed)",
        outcome: !g || g.status !== "final" ? "pending"
          : winner === p.predictedWinner ? "correct" : "incorrect",
      };
    });
    return { ok: true, result: { predictions, count: predictions.length } };
  });

  registerLensAction("sports", "prediction-record", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const games = new Map((s.games.get(userId) || []).map((g) => [g.id, g]));
    let correct = 0, incorrect = 0, pending = 0;
    for (const p of s.predictions.get(userId) || []) {
      const g = games.get(p.gameId);
      if (!g || g.status !== "final") { pending++; continue; }
      if (gameWinner(g) === p.predictedWinner) correct++;
      else incorrect++;
    }
    const decided = correct + incorrect;
    return {
      ok: true,
      result: {
        correct, incorrect, pending,
        accuracy: decided > 0 ? Math.round((correct / decided) * 100) : null,
      },
    };
  });

  // ── Watchlist ───────────────────────────────────────────────────────
  registerLensAction("sports", "watchlist-add", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    if (!findGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const wl = spListB(s.watchlist, userId);
    if (!wl.includes(params.gameId)) wl.push(String(params.gameId));
    saveSportsState();
    return { ok: true, result: { watchlistSize: wl.length } };
  });

  registerLensAction("sports", "watchlist-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const games = (s.watchlist.get(userId) || [])
      .map((id) => findGame(s, userId, id))
      .filter(Boolean)
      .map((g) => ({ ...g, winner: gameWinner(g) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { ok: true, result: { games, count: games.length } };
  });

  registerLensAction("sports", "watchlist-remove", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const wl = s.watchlist.get(spAid(ctx)) || [];
    const i = wl.indexOf(String(params.gameId));
    if (i < 0) return { ok: false, error: "game not on watchlist" };
    wl.splice(i, 1);
    saveSportsState();
    return { ok: true, result: { watchlistSize: wl.length } };
  });

  // ── Standings ───────────────────────────────────────────────────────
  registerLensAction("sports", "standing-set", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const team = spClean(params.team, 80);
    if (!team) return { ok: false, error: "team required" };
    const league = spClean(params.league, 40).toLowerCase() || "general";
    const userId = spAid(ctx);
    const rows = spListB(s.standings, userId);
    let row = rows.find((r) => r.team === team && r.league === league);
    if (!row) { row = { id: spId("std"), team, league, wins: 0, losses: 0, ties: 0 }; rows.push(row); }
    row.wins = Math.max(0, Math.round(spNum(params.wins, row.wins)));
    row.losses = Math.max(0, Math.round(spNum(params.losses, row.losses)));
    row.ties = Math.max(0, Math.round(spNum(params.ties, row.ties)));
    saveSportsState();
    return { ok: true, result: { standing: row } };
  });

  registerLensAction("sports", "standings-table", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let rows = [...(s.standings.get(spAid(ctx)) || [])];
    if (params.league) rows = rows.filter((r) => r.league === String(params.league).toLowerCase());
    const table = rows.map((r) => {
      const games = r.wins + r.losses + r.ties;
      return { ...r, games, winPct: games > 0 ? Math.round((r.wins / games) * 1000) / 1000 : 0 };
    }).sort((a, b) => b.winPct - a.winPct || b.wins - a.wins)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { ok: true, result: { table, teams: table.length } };
  });

  // ── Tracked athletes ────────────────────────────────────────────────
  registerLensAction("sports", "athlete-track", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = spClean(params.name, 80);
    if (!name) return { ok: false, error: "athlete name required" };
    const athlete = {
      id: spId("ath"), name,
      team: spClean(params.team, 80) || null,
      position: spClean(params.position, 40) || null,
      league: spClean(params.league, 40).toLowerCase() || "general",
      createdAt: spNow(),
    };
    spListB(s.athletes, spAid(ctx)).push(athlete);
    saveSportsState();
    return { ok: true, result: { athlete } };
  });

  registerLensAction("sports", "athlete-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { athletes: s.athletes.get(spAid(ctx)) || [] } };
  });

  registerLensAction("sports", "athlete-stat-log", (ctx, _a, params = {}) => {
  try {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    if (!findAthlete(s, userId, params.athleteId)) return { ok: false, error: "athlete not found" };
    const stats = params.stats && typeof params.stats === "object" ? params.stats : {};
    const clean = {};
    for (const [k, v] of Object.entries(stats)) {
      if (Number.isFinite(Number(v))) clean[spClean(k, 24).toLowerCase()] = Number(v);
    }
    const entry = {
      id: spId("stat"), athleteId: String(params.athleteId),
      date: spDay(params.date) || spDay(spNow()),
      opponent: spClean(params.opponent, 80) || null,
      stats: clean, createdAt: spNow(),
    };
    spListB(s.athleteStats, userId).push(entry);
    saveSportsState();
    return { ok: true, result: { statLine: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("sports", "athlete-stats", (ctx, _a, params = {}) => {
  try {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const athlete = findAthlete(s, userId, params.athleteId);
    if (!athlete) return { ok: false, error: "athlete not found" };
    const lines = (s.athleteStats.get(userId) || [])
      .filter((x) => x.athleteId === athlete.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const totals = {};
    for (const ln of lines) {
      for (const [k, v] of Object.entries(ln.stats)) totals[k] = Math.round(((totals[k] || 0) + v) * 100) / 100;
    }
    const averages = {};
    if (lines.length) {
      for (const [k, v] of Object.entries(totals)) averages[k] = Math.round((v / lines.length) * 100) / 100;
    }
    return { ok: true, result: { athlete, statLines: lines, games: lines.length, totals, averages } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Personalized feed + dashboard ───────────────────────────────────
  registerLensAction("sports", "my-scores", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const followed = new Set((s.teams.get(userId) || []).map((t) => t.name));
    const games = (s.games.get(userId) || [])
      .filter((g) => followed.has(g.homeTeam) || followed.has(g.awayTeam))
      .map((g) => ({ ...g, winner: gameWinner(g) }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      ok: true,
      result: {
        games,
        live: games.filter((g) => g.status === "live").length,
        followedTeams: followed.size,
      },
    };
  });

  registerLensAction("sports", "sports-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = spAid(ctx);
    const games = s.games.get(userId) || [];
    const predGames = new Map(games.map((g) => [g.id, g]));
    let correct = 0, decided = 0;
    for (const p of s.predictions.get(userId) || []) {
      const g = predGames.get(p.gameId);
      if (g && g.status === "final") { decided++; if (gameWinner(g) === p.predictedWinner) correct++; }
    }
    return {
      ok: true,
      result: {
        followedTeams: (s.teams.get(userId) || []).length,
        trackedGames: games.length,
        liveGames: games.filter((g) => g.status === "live").length,
        watchlist: (s.watchlist.get(userId) || []).length,
        trackedAthletes: (s.athletes.get(userId) || []).length,
        predictionAccuracy: decided > 0 ? Math.round((correct / decided) * 100) : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest real recent sports fixtures from TheSportsDB as
  // visible DTUs. Free public API (public test key "3").
  registerLensAction("sports", "feed", async (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    // League rotation: EPL, NBA, NFL, MLB, NHL.
    const leagues = ["4328", "4387", "4391", "4424", "4380"];
    const league = leagues[new Date().getDate() % leagues.length];
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${league}`);
      if (!r.ok) return { ok: false, error: `thesportsdb ${r.status}` };
      const data = await r.json();
      const events = (Array.isArray(data?.events) ? data.events : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const ev of events) {
        const id = `sportevent_${ev.idEvent}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const score = (ev.intHomeScore != null && ev.intAwayScore != null)
          ? `${ev.intHomeScore}–${ev.intAwayScore}` : "result pending";
        const title = `${ev.strEvent || "Match"} (${score})`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nLeague: ${ev.strLeague || "?"}\nDate: ${ev.dateEvent || "?"}\n${ev.strHomeTeam} ${ev.intHomeScore ?? "-"} — ${ev.intAwayScore ?? "-"} ${ev.strAwayTeam}\nVenue: ${ev.strVenue || "?"}`,
          tags: ["sports", "feed", "fixture", "thesportsdb"],
          source: "thesportsdb-feed",
          meta: { eventId: ev.idEvent, league: ev.strLeague, home: ev.strHomeTeam, away: ev.strAwayTeam, date: ev.dateEvent },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveSportsState();
      return { ok: true, result: { ingested, skipped, source: "thesportsdb-fixtures", dtuIds } };
    } catch (e) {
      return { ok: false, error: `thesportsdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // ESPN spectator core — play-by-play, schedules, news, player pages,
  // standings, win-probability. All free unkeyed public ESPN endpoints
  // via cachedFetchJson (5-min TTL). Pure-compute analytics layered on
  // top. Backlog: docs/lens-specs/sports.md.
  // ════════════════════════════════════════════════════════════════════

  // ── Live game detail / play-by-play ─────────────────────────────────
  // ESPN game summary endpoint: header + boxscore + scoring plays +
  // last-play. params: { sport, league?, eventId }
  registerLensAction("sports", "espn-game-summary", async (_ctx, _a, params = {}) => {
    const path = espnPathFor(params.sport, params.league);
    if (!path) return { ok: false, error: `unsupported sport (try: ${Object.keys(ESPN_SPORT_PATH).join(", ")}, soccer)` };
    const eventId = String(params.eventId || "").trim();
    if (!eventId) return { ok: false, error: "eventId required" };
    try {
      const data = await cachedFetchJson(
        `${ESPN_SITE}/${path}/summary?event=${encodeURIComponent(eventId)}`,
        { ttlMs: 60_000 },
      );
      const comp = data?.header?.competitions?.[0] || {};
      const teams = (comp.competitors || []).map((c) => ({
        team: c.team?.displayName, abbrev: c.team?.abbreviation,
        score: c.score != null ? Number(c.score) : null,
        homeAway: c.homeAway, winner: !!c.winner,
        logo: c.team?.logos?.[0]?.href || c.team?.logo || null,
        record: c.record?.[0]?.displayValue || null,
      }));
      // Scoring / key plays — works across pbp + scoringPlays shapes.
      const rawPlays = Array.isArray(data?.scoringPlays) ? data.scoringPlays
        : Array.isArray(data?.plays) ? data.plays : [];
      const plays = rawPlays.slice(-60).map((p) => ({
        id: p.id || p.sequenceNumber || null,
        text: p.text || p.shortText || p.type?.text || "",
        period: p.period?.number ?? p.period ?? null,
        clock: p.clock?.displayValue || p.clock || null,
        scoreValue: p.scoreValue ?? null,
        homeScore: p.homeScore ?? null,
        awayScore: p.awayScore ?? null,
        team: p.team?.abbreviation || p.team?.displayName || null,
        scoringPlay: !!p.scoringPlay,
      }));
      const article = data?.article || data?.gamepackageJSON?.article || null;
      return {
        ok: true,
        result: {
          eventId, sport: String(params.sport).toLowerCase(),
          status: data?.header?.competitions?.[0]?.status?.type?.description
            || comp.status?.type?.description || null,
          completed: !!(comp.status?.type?.completed),
          teams,
          venue: comp.venue?.fullName || data?.gameInfo?.venue?.fullName || null,
          plays, playCount: plays.length,
          recap: article ? { headline: article.headline, body: (article.story || "").slice(0, 600) } : null,
          source: "espn-summary",
        },
      };
    } catch (e) {
      return { ok: false, error: `espn unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Schedules / calendar of upcoming fixtures ───────────────────────
  // Pulls ESPN scoreboard for a date range and returns upcoming +
  // completed fixtures. params: { sport, league?, days? (1-14), date? }
  registerLensAction("sports", "espn-schedule", async (_ctx, _a, params = {}) => {
    const path = espnPathFor(params.sport, params.league);
    if (!path) return { ok: false, error: `unsupported sport (try: ${Object.keys(ESPN_SPORT_PATH).join(", ")}, soccer)` };
    const days = Math.max(1, Math.min(14, Math.round(spNum(params.days, 7))));
    const start = (() => {
      const d = params.date && /^\d{8}$/.test(String(params.date))
        ? new Date(`${String(params.date).slice(0,4)}-${String(params.date).slice(4,6)}-${String(params.date).slice(6,8)}`)
        : new Date();
      return d;
    })();
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    try {
      const fixtures = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        let data;
        try {
          data = await cachedFetchJson(`${ESPN_SCOREBOARD}/${path}/scoreboard?dates=${fmt(d)}`, { ttlMs: 300_000 });
        } catch { continue; }
        for (const ev of data?.events || []) {
          const comp = ev.competitions?.[0] || {};
          const cs = (comp.competitors || []);
          const home = cs.find((c) => c.homeAway === "home") || cs[0] || {};
          const away = cs.find((c) => c.homeAway === "away") || cs[1] || {};
          fixtures.push({
            id: ev.id, name: ev.shortName || ev.name, date: ev.date,
            day: fmt(d),
            home: home.team?.abbreviation || home.team?.displayName || "?",
            away: away.team?.abbreviation || away.team?.displayName || "?",
            homeScore: home.score != null ? Number(home.score) : null,
            awayScore: away.score != null ? Number(away.score) : null,
            status: ev.status?.type?.description || null,
            state: ev.status?.type?.state || null,
            completed: !!ev.status?.type?.completed,
            venue: comp.venue?.fullName || null,
          });
        }
      }
      fixtures.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        ok: true,
        result: {
          fixtures, count: fixtures.length,
          upcoming: fixtures.filter((f) => !f.completed && f.state !== "post").length,
          sport: String(params.sport).toLowerCase(), days, source: "espn-scoreboard",
        },
      };
    } catch (e) {
      return { ok: false, error: `espn unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── League standings tables (ESPN real data) ────────────────────────
  // params: { sport, league? }
  registerLensAction("sports", "espn-standings", async (_ctx, _a, params = {}) => {
    const path = espnPathFor(params.sport, params.league);
    if (!path) return { ok: false, error: `unsupported sport (try: ${Object.keys(ESPN_SPORT_PATH).join(", ")}, soccer)` };
    try {
      const data = await cachedFetchJson(
        `${ESPN_SITE}/${path}/standings?level=3`, { ttlMs: 600_000 },
      );
      const groups = [];
      const walk = (node) => {
        if (!node) return;
        const entries = node.standings?.entries;
        if (Array.isArray(entries) && entries.length) {
          groups.push({
            name: node.name || node.displayName || "League",
            teams: entries.map((e) => {
              const stat = (k) => {
                const s = (e.stats || []).find((x) => x.name === k || x.type === k);
                return s ? (s.value ?? (s.displayValue != null ? Number(s.displayValue) : null)) : null;
              };
              return {
                team: e.team?.displayName || e.team?.name,
                abbrev: e.team?.abbreviation,
                logo: e.team?.logos?.[0]?.href || null,
                wins: stat("wins"), losses: stat("losses"),
                ties: stat("ties"), winPercent: stat("winPercent"),
                pointsFor: stat("pointsFor"), pointsAgainst: stat("pointsAgainst"),
                gamesBehind: stat("gamesBehind"),
                streak: ((e.stats || []).find((x) => x.name === "streak") || {}).displayValue || null,
                rank: stat("playoffSeed") ?? stat("rank") ?? null,
              };
            }),
          });
        }
        for (const c of node.children || []) walk(c);
      };
      for (const c of data?.children || [data]) walk(c);
      return {
        ok: true,
        result: { groups, groupCount: groups.length, sport: String(params.sport).toLowerCase(), source: "espn-standings" },
      };
    } catch (e) {
      return { ok: false, error: `espn unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── News / headlines feed (ESPN public news API) ────────────────────
  // params: { sport, league?, limit? }
  registerLensAction("sports", "espn-news", async (_ctx, _a, params = {}) => {
    const path = espnPathFor(params.sport, params.league);
    if (!path) return { ok: false, error: `unsupported sport (try: ${Object.keys(ESPN_SPORT_PATH).join(", ")}, soccer)` };
    const limit = Math.max(1, Math.min(30, Math.round(spNum(params.limit, 12))));
    try {
      const data = await cachedFetchJson(
        `${ESPN_SITE}/${path}/news?limit=${limit}`, { ttlMs: 300_000 },
      );
      const articles = (data?.articles || []).slice(0, limit).map((a) => ({
        headline: a.headline, description: a.description || null,
        published: a.published || null,
        byline: a.byline || null,
        type: a.type || null,
        image: a.images?.[0]?.url || null,
        link: a.links?.web?.href || a.links?.mobile?.href || null,
      }));
      return {
        ok: true,
        result: { articles, count: articles.length, sport: String(params.sport).toLowerCase(), source: "espn-news" },
      };
    } catch (e) {
      return { ok: false, error: `espn unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Team roster + player profiles (TheSportsDB) ─────────────────────
  // params: { teamId } — TheSportsDB team id (from team-lookup)
  registerLensAction("sports", "team-roster", async (_ctx, _a, params = {}) => {
    const teamId = String(params.teamId || "").trim();
    if (!teamId) return { ok: false, error: "teamId required (from team-lookup)" };
    const apiKey = process.env.SPORTSDB_API_KEY || "3";
    try {
      const data = await cachedFetchJson(
        `${SPORTSDB_BASE}/${encodeURIComponent(apiKey)}/lookup_all_players.php?id=${encodeURIComponent(teamId)}`,
        { ttlMs: 3_600_000 },
      );
      const players = (data?.player || []).map((p) => ({
        id: p.idPlayer, name: p.strPlayer,
        position: p.strPosition || null,
        nationality: p.strNationality || null,
        birthDate: p.dateBorn || null,
        height: p.strHeight || null, weight: p.strWeight || null,
        number: p.strNumber || null,
        thumb: p.strThumb || p.strCutout || null,
        team: p.strTeam || null, sport: p.strSport || null,
        description: (p.strDescriptionEN || "").slice(0, 400) || null,
        wage: p.strWage || null, signing: p.strSigning || null,
      }));
      return {
        ok: true,
        result: { players, count: players.length, teamId, source: "thesportsdb" },
      };
    } catch (e) {
      return { ok: false, error: `thesportsdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Player profile lookup (TheSportsDB) ─────────────────────────────
  // params: { name } — searches players by name
  registerLensAction("sports", "player-lookup", async (_ctx, _a, params = {}) => {
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "player name required" };
    const apiKey = process.env.SPORTSDB_API_KEY || "3";
    try {
      const data = await cachedFetchJson(
        `${SPORTSDB_BASE}/${encodeURIComponent(apiKey)}/searchplayers.php?p=${encodeURIComponent(name)}`,
        { ttlMs: 3_600_000 },
      );
      const players = (data?.player || []).map((p) => ({
        id: p.idPlayer, name: p.strPlayer,
        team: p.strTeam || null, sport: p.strSport || null,
        position: p.strPosition || null,
        nationality: p.strNationality || null,
        birthDate: p.dateBorn || null, birthLocation: p.strBirthLocation || null,
        height: p.strHeight || null, weight: p.strWeight || null,
        thumb: p.strThumb || p.strCutout || null,
        description: (p.strDescriptionEN || "").slice(0, 600) || null,
        wage: p.strWage || null, signing: p.strSigning || null,
        gender: p.strGender || null,
      }));
      return {
        ok: true,
        result: { players, count: players.length, query: name, source: "thesportsdb" },
      };
    } catch (e) {
      return { ok: false, error: `thesportsdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Game reminders (persistent per-user) ────────────────────────────
  registerLensAction("sports", "reminder-set", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.reminders instanceof Map)) s.reminders = new Map();
    const matchup = spClean(params.matchup, 120);
    if (!matchup) return { ok: false, error: "matchup required" };
    const reminder = {
      id: spId("rmd"), matchup,
      sport: spClean(params.sport, 24).toLowerCase() || "general",
      eventId: spClean(params.eventId, 40) || null,
      kickoff: spClean(params.kickoff, 40) || null,
      note: spClean(params.note, 200) || null,
      createdAt: spNow(),
    };
    spListB(s.reminders, spAid(ctx)).push(reminder);
    saveSportsState();
    return { ok: true, result: { reminder } };
  });

  registerLensAction("sports", "reminder-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.reminders instanceof Map)) s.reminders = new Map();
    const now = Date.now();
    const reminders = [...(s.reminders.get(spAid(ctx)) || [])]
      .map((r) => ({
        ...r,
        upcoming: r.kickoff ? new Date(r.kickoff).getTime() > now : null,
      }))
      .sort((a, b) => String(a.kickoff || a.createdAt).localeCompare(String(b.kickoff || b.createdAt)));
    return { ok: true, result: { reminders, count: reminders.length } };
  });

  registerLensAction("sports", "reminder-delete", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.reminders instanceof Map)) s.reminders = new Map();
    const arr = s.reminders.get(spAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reminder not found" };
    arr.splice(i, 1);
    saveSportsState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Bracket builder (persistent per-user, single-elimination) ───────
  registerLensAction("sports", "bracket-create", (ctx, _a, params = {}) => {
  try {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.brackets instanceof Map)) s.brackets = new Map();
    const name = spClean(params.name, 80);
    if (!name) return { ok: false, error: "bracket name required" };
    let teams = Array.isArray(params.teams)
      ? params.teams.map((t) => spClean(t, 60)).filter(Boolean)
      : [];
    // Single-elimination needs a power-of-2 field.
    if (teams.length < 2) return { ok: false, error: "at least 2 teams required" };
    let size = 2;
    while (size < teams.length) size *= 2;
    while (teams.length < size) teams.push("BYE");
    // Build round 0 matchups (seed pairing 1v8, 2v7…).
    const matches = [];
    for (let i = 0; i < size / 2; i++) {
      matches.push({
        id: spId("mt"), round: 0, slot: i,
        teamA: teams[i], teamB: teams[size - 1 - i],
        winner: teams[size - 1 - i] === "BYE" ? teams[i]
          : teams[i] === "BYE" ? teams[size - 1 - i] : null,
      });
    }
    const bracket = {
      id: spId("brk"), name, size, teams,
      rounds: Math.log2(size), matches, createdAt: spNow(),
    };
    spListB(s.brackets, spAid(ctx)).push(bracket);
    saveSportsState();
    return { ok: true, result: { bracket } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("sports", "bracket-list", (ctx, _a, _params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.brackets instanceof Map)) s.brackets = new Map();
    return { ok: true, result: { brackets: s.brackets.get(spAid(ctx)) || [] } };
  });

  registerLensAction("sports", "bracket-advance", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.brackets instanceof Map)) s.brackets = new Map();
    const bracket = (s.brackets.get(spAid(ctx)) || []).find((b) => b.id === params.bracketId);
    if (!bracket) return { ok: false, error: "bracket not found" };
    const match = bracket.matches.find((m) => m.id === params.matchId);
    if (!match) return { ok: false, error: "match not found" };
    const winner = spClean(params.winner, 60);
    if (winner !== match.teamA && winner !== match.teamB) {
      return { ok: false, error: "winner must be one of the match teams" };
    }
    match.winner = winner;
    // Snapshot previously-set winners keyed by (round, slot) so they
    // survive the downstream rebuild — without this, advancing a later
    // round wipes its own result and a champion can never be crowned.
    const priorWinners = new Map(
      bracket.matches.map((m) => [`${m.round}:${m.slot}`, m.winner]),
    );
    // Rebuild downstream rounds from current winners.
    let cur = bracket.matches.filter((m) => m.round === 0).sort((a, b) => a.slot - b.slot);
    bracket.matches = bracket.matches.filter((m) => m.round === 0);
    let round = 1;
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        const a = cur[i].winner, b = cur[i + 1]?.winner;
        const teamA = a || null, teamB = b || null;
        // Keep a prior winner only if it's still a participant.
        const prior = priorWinners.get(`${round}:${i / 2}`);
        const winnerStillValid = prior && (prior === teamA || prior === teamB) ? prior : null;
        next.push({
          id: spId("mt"), round, slot: i / 2,
          teamA, teamB,
          winner: winnerStillValid,
        });
      }
      bracket.matches.push(...next);
      cur = next; round++;
    }
    const finalMatch = bracket.matches[bracket.matches.length - 1];
    bracket.champion = finalMatch && finalMatch.winner ? finalMatch.winner : null;
    saveSportsState();
    return { ok: true, result: { bracket } };
  });

  registerLensAction("sports", "bracket-delete", (ctx, _a, params = {}) => {
    const s = getSportsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.brackets instanceof Map)) s.brackets = new Map();
    const arr = s.brackets.get(spAid(ctx)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "bracket not found" };
    arr.splice(i, 1);
    saveSportsState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Win-probability / advanced analytics overlay ────────────────────
  // Pure-compute Elo-style model from score differential, time
  // remaining, and home advantage. Works on a live ESPN game or any
  // ad-hoc score state. params: { homeScore, awayScore, period,
  //   periodsTotal?, clock? (mm:ss), homeField? }
  registerLensAction("sports", "win-probability", (_ctx, _a, params = {}) => {
    const homeScore = spNum(params.homeScore, 0);
    const awayScore = spNum(params.awayScore, 0);
    const period = Math.max(1, spNum(params.period, 1));
    const periodsTotal = Math.max(period, spNum(params.periodsTotal, 4));
    const homeField = params.homeField === false ? 0 : spNum(params.homeField, 2.5);
    // Fraction of game elapsed (0..1).
    let clockFrac = 0;
    if (typeof params.clock === "string" && /^\d{1,2}:\d{2}$/.test(params.clock)) {
      const [m, sec] = params.clock.split(":").map(Number);
      // assume 12-min periods unless overridden
      const periodLen = spNum(params.periodMinutes, 12);
      clockFrac = Math.max(0, 1 - (m + sec / 60) / periodLen);
    }
    const elapsed = Math.min(1, ((period - 1) + clockFrac) / periodsTotal);
    const remaining = Math.max(0.0001, 1 - elapsed);
    // Margin, adjusted by home-field, scaled by remaining time. The
    // closer to the end, the more a lead "locks in" the result.
    const adjMargin = (homeScore - awayScore) + homeField;
    // Logistic curve: scale steepens as the game progresses.
    const steepness = 0.12 + 0.55 * (1 - remaining);
    const z = adjMargin * steepness / Math.sqrt(remaining);
    const homeWinPct = Math.round((1 / (1 + Math.exp(-z))) * 1000) / 10;
    const leader = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "tied";
    return {
      ok: true,
      result: {
        homeWinPct,
        awayWinPct: Math.round((100 - homeWinPct) * 10) / 10,
        leader, margin: homeScore - awayScore,
        elapsedFraction: Math.round(elapsed * 1000) / 1000,
        period, periodsTotal,
        favored: homeWinPct >= 50 ? "home" : "away",
        confidence: Math.abs(homeWinPct - 50) >= 35 ? "high"
          : Math.abs(homeWinPct - 50) >= 15 ? "moderate" : "tossup",
        model: "logistic-margin-time (pure-compute, illustrative)",
      },
    };
  });
}
