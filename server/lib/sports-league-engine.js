// server/lib/sports-league-engine.js
//
// Phase II Wave 17 — sports leagues persistent loop.
//
//   openLeague + addTeam + addRosterMember
//   requestTryout / passTryout
//   scheduleMatch / playMatch (deterministic outcome from power_score
//   + crew skill aggregate; rollOverride for tests)
//   advanceCareerStage on milestones
//   tickLeagues — advances scheduled matches whose time has come

import crypto from "node:crypto";

const STAGE_THRESHOLDS = Object.freeze({
  amateur:   { matches: 0,   mvp: 0,  total: 0 },
  semi_pro:  { matches: 5,   mvp: 0,  total: 50 },
  pro:       { matches: 20,  mvp: 2,  total: 200 },
  all_star:  { matches: 60,  mvp: 8,  total: 750 },
  legend:    { matches: 150, mvp: 20, total: 2500 },
});

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── League / team / roster ──────────────────────────────────── */

export function openLeague(db, opts) {
  if (!opts?.worldId || !opts?.name || !opts?.sportKind) return { ok: false, reason: "missing_inputs" };
  const id = uid("lg");
  db.prepare(`
    INSERT INTO sports_leagues (id, world_id, name, sport_kind)
    VALUES (?, ?, ?, ?)
  `).run(id, opts.worldId, String(opts.name).slice(0, 120), opts.sportKind);
  return { ok: true, leagueId: id };
}

export function addTeam(db, leagueId, name, powerScore = 50) {
  const id = uid("team");
  db.prepare(`
    INSERT INTO sports_teams (id, league_id, name, power_score) VALUES (?, ?, ?, ?)
  `).run(id, leagueId, String(name).slice(0, 120), Math.max(0, Math.min(100, Number(powerScore) || 50)));
  return { ok: true, teamId: id };
}

export function addRosterMember(db, teamId, memberKind, memberId, role = "roster") {
  const validRole = ["roster", "starter", "captain", "coach", "manager"].includes(role) ? role : "roster";
  try {
    db.prepare(`
      INSERT INTO sports_rosters (team_id, member_kind, member_id, role)
      VALUES (?, ?, ?, ?)
    `).run(teamId, memberKind, memberId, validRole);
    return { ok: true };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return { ok: true, alreadyOnRoster: true };
    return { ok: false, reason: "insert_failed", message: err?.message };
  }
}

export function listTeamsInLeague(db, leagueId) {
  return db.prepare(`
    SELECT * FROM sports_teams WHERE league_id = ? ORDER BY (wins - losses) DESC, wins DESC LIMIT 50
  `).all(leagueId);
}

/* ───────── Tryouts + careers ───────────────────────────────────────── */

export function ensureCareer(db, playerUserId, sportKind) {
  let career = db.prepare(`
    SELECT * FROM sports_careers WHERE player_user_id = ? AND sport_kind = ?
  `).get(playerUserId, sportKind);
  if (!career) {
    const id = uid("car");
    db.prepare(`
      INSERT INTO sports_careers (id, player_user_id, sport_kind) VALUES (?, ?, ?)
    `).run(id, playerUserId, sportKind);
    career = db.prepare(`SELECT * FROM sports_careers WHERE id = ?`).get(id);
  }
  return career;
}

export function requestTryout(db, playerUserId, leagueId, opts = {}) {
  const league = db.prepare("SELECT * FROM sports_leagues WHERE id = ?").get(leagueId);
  if (!league) return { ok: false, reason: "league_not_found" };
  const career = ensureCareer(db, playerUserId, league.sport_kind);
  const athleteScore = Math.max(0, Math.min(100, Number(opts.athleticSkill) || 30));
  const reflexScore  = Math.max(0, Math.min(100, Number(opts.reflexSkill) || 30));
  const composite = (athleteScore + reflexScore) / 2;
  // Pro stage and up require a high composite; lower stages let through more candidates
  const required = career.stage === "amateur" ? 30
                 : career.stage === "semi_pro" ? 50
                 : career.stage === "pro" ? 70
                 : 85;
  const passed = composite >= required;
  db.prepare(`
    UPDATE sports_careers SET tryouts_attempted = tryouts_attempted + 1,
      tryouts_passed = tryouts_passed + ?
    WHERE id = ?
  `).run(passed ? 1 : 0, career.id);
  return { ok: true, passed, composite, required };
}

/* ───────── Matches ─────────────────────────────────────────────────── */

export function scheduleMatch(db, leagueId, homeTeamId, awayTeamId, scheduledAt) {
  const id = uid("match");
  db.prepare(`
    INSERT INTO sports_matches (id, league_id, home_team_id, away_team_id, scheduled_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, leagueId, homeTeamId, awayTeamId, Math.max(1, Math.floor(Number(scheduledAt) || (Math.floor(Date.now() / 1000) + 3600))));
  return { ok: true, matchId: id };
}

/**
 * Deterministic match outcome from power_score diff.
 *   homeWinChance = 0.5 + 0.005 × (homePower − awayPower) + homeAdvantage
 *
 * Caller can pass rollOverride for tests. The match generates scores
 * 0..N where N scales with the sport kind (basketball higher, brawling lower).
 */
const SCORE_RANGES = {
  basketball: 110, soccer: 4, brawling: 6, racing: 3, esports: 24, baseball: 9,
};

export function playMatch(db, matchId, opts = {}) {
  const m = db.prepare("SELECT * FROM sports_matches WHERE id = ?").get(matchId);
  if (!m) return { ok: false, reason: "match_not_found" };
  if (m.played_at) return { ok: false, reason: "already_played" };
  const league = db.prepare("SELECT * FROM sports_leagues WHERE id = ?").get(m.league_id);
  const home = db.prepare("SELECT * FROM sports_teams WHERE id = ?").get(m.home_team_id);
  const away = db.prepare("SELECT * FROM sports_teams WHERE id = ?").get(m.away_team_id);
  if (!home || !away || !league) return { ok: false, reason: "missing_team_or_league" };
  const homeAdvantage = 0.04;
  const homeWinChance = Math.max(0.05, Math.min(0.95,
    0.5 + 0.005 * (home.power_score - away.power_score) + homeAdvantage
  ));
  const roll = Number.isFinite(opts.rollOverride) ? Number(opts.rollOverride) : Math.random();
  const scoreCap = SCORE_RANGES[league.sport_kind] || 10;
  const homeWon = roll < homeWinChance;
  const homeScore = Math.max(0, Math.floor(scoreCap * (homeWon ? 0.5 + (1 - roll) * 0.5 : 0.2 + roll * 0.4)));
  const awayScore = Math.max(0, Math.floor(scoreCap * (homeWon ? 0.2 + roll * 0.4 : 0.5 + roll * 0.5)));

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sports_matches
         SET home_score = ?, away_score = ?, played_at = unixepoch(), status = 'finished'
       WHERE id = ?
    `).run(homeScore, awayScore, matchId);
    if (homeScore > awayScore) {
      db.prepare(`UPDATE sports_teams SET wins = wins + 1, power_score = MIN(100, power_score + 0.5) WHERE id = ?`).run(m.home_team_id);
      db.prepare(`UPDATE sports_teams SET losses = losses + 1, power_score = MAX(0, power_score - 0.4) WHERE id = ?`).run(m.away_team_id);
    } else if (awayScore > homeScore) {
      db.prepare(`UPDATE sports_teams SET wins = wins + 1, power_score = MIN(100, power_score + 0.5) WHERE id = ?`).run(m.away_team_id);
      db.prepare(`UPDATE sports_teams SET losses = losses + 1, power_score = MAX(0, power_score - 0.4) WHERE id = ?`).run(m.home_team_id);
    } else {
      db.prepare(`UPDATE sports_teams SET draws = draws + 1 WHERE id = ?`).run(m.home_team_id);
      db.prepare(`UPDATE sports_teams SET draws = draws + 1 WHERE id = ?`).run(m.away_team_id);
    }
  });
  tx();
  return {
    ok: true,
    matchId,
    homeScore,
    awayScore,
    homeWon,
    homeWinChance,
  };
}

export function advanceCareerStage(db, careerId) {
  const c = db.prepare("SELECT * FROM sports_careers WHERE id = ?").get(careerId);
  if (!c) return { ok: false, reason: "career_not_found" };
  const order = ["amateur", "semi_pro", "pro", "all_star", "legend"];
  const currentIdx = order.indexOf(c.stage);
  if (currentIdx >= order.length - 1) return { ok: true, stage: c.stage, max: true };
  const next = order[currentIdx + 1];
  const threshold = STAGE_THRESHOLDS[next];
  const eligible = c.matches_played >= threshold.matches
                && c.mvp_awards    >= threshold.mvp
                && c.total_score   >= threshold.total;
  if (!eligible) return { ok: false, reason: "not_eligible", current: c.stage, next, threshold };
  db.prepare(`UPDATE sports_careers SET stage = ? WHERE id = ?`).run(next, careerId);
  return { ok: true, stage: next };
}

export function recordMatchOutcome(db, careerId, points, wonMvp = false) {
  const pts = Math.max(0, Math.floor(Number(points) || 0));
  db.prepare(`
    UPDATE sports_careers
       SET matches_played = matches_played + 1,
           total_score    = total_score + ?,
           mvp_awards     = mvp_awards + ?
     WHERE id = ?
  `).run(pts, wonMvp ? 1 : 0, careerId);
  return { ok: true };
}

export function retireCareer(db, careerId) {
  const r = db.prepare(`UPDATE sports_careers SET retired_at = unixepoch() WHERE id = ? AND retired_at IS NULL`).run(careerId);
  return { ok: r.changes > 0 };
}

export function tickLeagues(db) {
  const now = Math.floor(Date.now() / 1000);
  const due = db.prepare(`
    SELECT id FROM sports_matches WHERE status = 'scheduled' AND scheduled_at <= ? LIMIT 50
  `).all(now);
  const results = [];
  for (const { id } of due) results.push(playMatch(db, id));
  return { ok: true, played: results.length, results };
}

export const SPORTS_CONSTANTS = Object.freeze({
  STAGE_THRESHOLDS,
  SCORE_RANGES,
});
