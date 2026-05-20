// server/domains/sports.js
//
// Pure-compute helpers (performance stats, training plan, injury risk,
// team analysis) plus real free APIs (TheSportsDB for team / league /
// fixture lookups, ESPN scoreboard for live scores).
//
// TheSportsDB free dev key "3"; production may set SPORTSDB_API_KEY.
// ESPN's public scoreboard endpoint is unkeyed (rate-limited).

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports";

export default function registerSportsActions(registerLensAction) {
  registerLensAction("sports", "performanceStats", (ctx, artifact, _params) => { const stats = artifact.data?.stats || []; if (stats.length === 0) return { ok: true, result: { message: "Add performance statistics to analyze." } }; const values = stats.map(s => parseFloat(s.value) || 0); const avg = values.reduce((s,v)=>s+v,0)/values.length; const best = Math.max(...values); const worst = Math.min(...values); const recent5 = values.slice(-5); const trend = recent5.length >= 2 ? (recent5[recent5.length-1] > recent5[0] ? "improving" : "declining") : "insufficient"; return { ok: true, result: { metric: stats[0]?.metric || "performance", average: Math.round(avg*100)/100, best, worst, trend, recentAvg: Math.round(recent5.reduce((s,v)=>s+v,0)/recent5.length*100)/100, consistency: Math.round(Math.sqrt(values.reduce((s,v)=>s+Math.pow(v-avg,2),0)/values.length)*100)/100, dataPoints: values.length } }; });
  registerLensAction("sports", "trainingPlan", (ctx, artifact, _params) => { const data = artifact.data || {}; const sport = (data.sport || "general").toLowerCase(); const level = (data.level || "intermediate").toLowerCase(); const daysPerWeek = parseInt(data.daysPerWeek) || 4; const plans = { running: ["Easy run", "Tempo run", "Intervals", "Long run", "Rest", "Cross-train", "Easy run"], swimming: ["Technique drills", "Speed sets", "Endurance", "Recovery", "Rest", "Open water", "Drills"], cycling: ["Base ride", "Hill repeats", "Tempo", "Long ride", "Rest", "Recovery spin", "Group ride"], general: ["Strength", "Cardio", "HIIT", "Active recovery", "Rest", "Flexibility", "Sport-specific"] }; const template = plans[sport] || plans.general; const schedule = template.slice(0, daysPerWeek).map((workout, i) => ({ day: i+1, workout, intensity: workout.includes("Rest") || workout.includes("Recovery") ? "low" : workout.includes("HIIT") || workout.includes("Interval") ? "high" : "moderate" })); return { ok: true, result: { sport, level, daysPerWeek, schedule, weeklyStructure: { hard: schedule.filter(s => s.intensity === "high").length, moderate: schedule.filter(s => s.intensity === "moderate").length, easy: schedule.filter(s => s.intensity === "low").length }, principle: "Follow 80/20 rule: 80% easy, 20% hard" } }; });
  registerLensAction("sports", "injuryRisk", (ctx, artifact, _params) => { const data = artifact.data || {}; const trainingLoad = parseFloat(data.weeklyHours) || 0; const restDays = parseInt(data.restDaysPerWeek) || 2; const previousInjuries = parseInt(data.previousInjuries) || 0; const age = parseInt(data.age) || 25; const sleep = parseFloat(data.sleepHours) || 7; let risk = 20; if (trainingLoad > 15) risk += 20; if (restDays < 1) risk += 25; if (previousInjuries > 2) risk += 15; if (age > 40) risk += 10; if (sleep < 6) risk += 15; risk = Math.min(100, risk); return { ok: true, result: { riskScore: risk, riskLevel: risk >= 60 ? "high" : risk >= 35 ? "moderate" : "low", factors: { trainingLoad, restDays, previousInjuries, age, sleepHours: sleep }, recommendations: risk >= 40 ? [restDays < 2 ? "Add rest days" : null, sleep < 7 ? "Prioritize 7-9 hours sleep" : null, trainingLoad > 12 ? "Reduce training volume 10-20%" : null, "Include proper warm-up and cool-down"].filter(Boolean) : ["Continue current training — risk is manageable"] } }; });
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
    let news = [...(s.teamNews.get(spAid(ctx)) || [])];
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
  });

  registerLensAction("sports", "athlete-stats", (ctx, _a, params = {}) => {
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
}
