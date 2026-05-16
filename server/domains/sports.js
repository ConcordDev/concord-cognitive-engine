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
}
