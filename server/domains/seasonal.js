// server/domains/seasonal.js
//
// Seasonal-content lens-action domain (id "seasonal"). Backs the
// SeasonalContent panel with REAL data:
//
//   - events-list: derived from the ACTUAL Concordia season calendar
//     (server/lib/seasons.js — 6 seasons × 7 real-world days = 42-day year).
//     The current season, day-in-season, narrative, and seasonal node-yield
//     biases are real calendrical facts, not fabricated. A `season`/`day`
//     param override makes it deterministic + testable.
//   - challenge-create / challenges-list / challenge-progress: per-user
//     monthly challenges (STATE-backed, no migrations). Real CRUD + progress
//     math; empty until the user creates one.
//   - competition-create / competitions-list: per-user annual competitions
//     (STATE-backed). Real round-trip; empty until created.
//
// In-memory, STATE-backed. Per-user scope via ctx.actor.userId.

import {
  SEASONS,
  SEASON_NODE_YIELD_MULT,
  seasonFor,
  yearFor,
  _internal,
} from "../lib/seasons.js";

const SEASON_LENGTH_DAYS = _internal.SEASON_LENGTH_DAYS; // 7

export default function registerSeasonalActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function seasonalStore() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.seasonalChallenges ??= new Map();    // userId -> Map<challengeId, Challenge>
    STATE.seasonalCompetitions ??= new Map();  // userId -> Map<competitionId, Competition>
    return STATE;
  }
  function saveSeasonal() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function userChallenges(STATE, userId) {
    if (!STATE.seasonalChallenges.has(userId)) STATE.seasonalChallenges.set(userId, new Map());
    return STATE.seasonalChallenges.get(userId);
  }
  function userCompetitions(STATE, userId) {
    if (!STATE.seasonalCompetitions.has(userId)) STATE.seasonalCompetitions.set(userId, new Map());
    return STATE.seasonalCompetitions.get(userId);
  }

  // The frontend SeasonalContent component knows only the 4 mundane seasons
  // ('spring' | 'summer' | 'fall' | 'winter'). Map the real 6-season Concordia
  // calendar onto that quad for display, without inventing data.
  const DISPLAY_SEASON = {
    spring: "spring",
    summer: "summer",
    monsoon: "summer",
    harvest: "fall",
    frost: "winter",
    deep_winter: "winter",
  };

  // Resolve the season either from an explicit override (name or idx) or from
  // the real wall clock. Returns the canonical SEASONS entry + day-in-season.
  function resolveSeason(p) {
    // Explicit season override (name string or numeric idx)?
    if (p.season != null && p.season !== "") {
      let entry = null;
      if (typeof p.season === "number" || /^\d+$/.test(String(p.season))) {
        const idx = Number(p.season);
        entry = SEASONS.find((s) => s.idx === idx) || null;
      } else {
        const nm = String(p.season).trim().toLowerCase();
        entry = SEASONS.find((s) => s.name === nm) || null;
      }
      if (entry) {
        let day = Number.isFinite(Number(p.day)) ? Number(p.day) : 1;
        if (day < 1) day = 1;
        if (day > SEASON_LENGTH_DAYS) day = SEASON_LENGTH_DAYS;
        const year = Number.isFinite(Number(p.year)) ? Number(p.year) : 1;
        return { entry, day, year, overridden: true };
      }
    }
    // Real calendar.
    const now = Number.isFinite(Number(p.now)) ? Number(p.now) : Date.now();
    const entry = seasonFor(now);
    const dayOfYear = Math.floor(now / 86400000) % (SEASONS.length * SEASON_LENGTH_DAYS);
    const day = (dayOfYear % SEASON_LENGTH_DAYS) + 1;
    return { entry, day, year: yearFor(now), overridden: false };
  }

  // ── events-list — REAL season-calendar-derived content ───────────
  registerLensAction("seasonal", "events-list", (ctx, _artifact, params = {}) => {
    try {
      const p = params || {};
      const { entry, day, year } = resolveSeason(p);
      const display = DISPLAY_SEASON[entry.name] || "spring";

      // Day-anchored ISO window for this season instance (deterministic
      // labels). Day 1 of the season starts (day-1) days "ago" from now.
      const dayMs = 86400000;
      const base = Number.isFinite(Number(p.now)) ? Number(p.now) : Date.now();
      const seasonStartMs = base - (day - 1) * dayMs;
      const seasonEndMs = seasonStartMs + (SEASON_LENGTH_DAYS - 1) * dayMs;
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      const startDate = iso(seasonStartMs);
      const endDate = iso(seasonEndMs);

      // The season itself is the canonical seasonal event (a real festival of
      // the turning year), plus one yield-bias "event" per resource the
      // season meaningfully boosts (the real SEASON_NODE_YIELD_MULT facts).
      const events = [];
      events.push({
        id: `season-${entry.name}-y${year}`,
        name: `${cap(entry.name.replace("_", " "))} (Year ${year})`,
        season: display,
        startDate,
        endDate,
        description: entry.narrative,
        type: "festival",
      });

      const yieldTable = SEASON_NODE_YIELD_MULT[entry.name] || {};
      for (const [resource, mult] of Object.entries(yieldTable)) {
        if (resource === "default") continue;
        if (mult >= 1.3) {
          events.push({
            id: `yield-${entry.name}-${resource}`,
            name: `${cap(resource)} Bounty`,
            season: display,
            startDate,
            endDate,
            description: `${cap(resource)} gathering yields ${mult}× during ${entry.name.replace("_", " ")}.`,
            type: "challenge",
          });
        } else if (mult <= 0.5) {
          events.push({
            id: `scarcity-${entry.name}-${resource}`,
            name: `${cap(resource)} Scarcity`,
            season: display,
            startDate,
            endDate,
            description: `${cap(resource)} gathering yields only ${mult}× during ${entry.name.replace("_", " ")}.`,
            type: "holiday",
          });
        }
      }

      return {
        ok: true,
        result: {
          currentSeason: display,
          seasonName: entry.name,
          seasonIdx: entry.idx,
          day,
          dayOfSeason: day,
          seasonLengthDays: SEASON_LENGTH_DAYS,
          year,
          narrative: entry.narrative,
          tempBias: entry.tempBias,
          humidityBias: entry.humidityBias,
          lightBias: entry.lightBias,
          events,
          count: events.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── challenge-create ─────────────────────────────────────────────
  registerLensAction("seasonal", "challenge-create", (ctx, _artifact, params = {}) => {
    try {
      const STATE = seasonalStore();
      const userId = aid(ctx);
      const p = params || {};
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const objective = String(p.objective || "").trim();
      if (!objective) return { ok: false, error: "objective required" };
      const maxProgress = Number(p.maxProgress);
      if (!Number.isFinite(maxProgress) || maxProgress <= 0) {
        return { ok: false, error: "maxProgress must be a positive number" };
      }
      const challenge = {
        id: sid("chal"),
        title,
        description: String(p.description || "").trim(),
        objective,
        progress: 0,
        maxProgress,
        reward: {
          type: String(p.reward?.type || p.rewardType || "cc"),
          value: String(p.reward?.value || p.rewardValue || ""),
        },
        leaderboardId: p.leaderboardId ? String(p.leaderboardId) : `lb_${sid("")}`,
        season: p.season ? String(p.season) : null,
        completed: false,
        createdAt: new Date().toISOString(),
      };
      userChallenges(STATE, userId).set(challenge.id, challenge);
      saveSeasonal();
      return { ok: true, result: { challenge } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── challenges-list (per-user) ───────────────────────────────────
  registerLensAction("seasonal", "challenges-list", (ctx, _artifact, params = {}) => {
    try {
      const STATE = seasonalStore();
      const userId = aid(ctx);
      const p = params || {};
      let list = [...userChallenges(STATE, userId).values()];
      if (p.activeOnly) list = list.filter((c) => !c.completed);
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { ok: true, result: { challenges: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── challenge-progress (advance progress math) ───────────────────
  registerLensAction("seasonal", "challenge-progress", (ctx, _artifact, params = {}) => {
    try {
      const STATE = seasonalStore();
      const userId = aid(ctx);
      const p = params || {};
      const challenge = userChallenges(STATE, userId).get(String(p.id || ""));
      if (!challenge) return { ok: false, error: "challenge not found" };
      // Either a delta (+N) or an absolute `progress` value.
      let next = challenge.progress;
      if (p.delta !== undefined) {
        const d = Number(p.delta);
        if (!Number.isFinite(d)) return { ok: false, error: "delta must be numeric" };
        next = challenge.progress + d;
      } else if (p.progress !== undefined) {
        const abs = Number(p.progress);
        if (!Number.isFinite(abs)) return { ok: false, error: "progress must be numeric" };
        next = abs;
      } else {
        return { ok: false, error: "delta or progress required" };
      }
      // Clamp to [0, maxProgress].
      if (next < 0) next = 0;
      if (next > challenge.maxProgress) next = challenge.maxProgress;
      challenge.progress = next;
      challenge.completed = next >= challenge.maxProgress;
      challenge.percent = Math.round((next / challenge.maxProgress) * 100);
      challenge.updatedAt = new Date().toISOString();
      saveSeasonal();
      return {
        ok: true,
        result: {
          challenge,
          progress: challenge.progress,
          maxProgress: challenge.maxProgress,
          percent: challenge.percent,
          completed: challenge.completed,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── competition-create ───────────────────────────────────────────
  registerLensAction("seasonal", "competition-create", (ctx, _artifact, params = {}) => {
    try {
      const STATE = seasonalStore();
      const userId = aid(ctx);
      const p = params || {};
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const categories = Array.isArray(p.categories)
        ? p.categories.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (categories.length === 0) return { ok: false, error: "at least one category required" };
      const prizes = Array.isArray(p.prizes)
        ? p.prizes.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const competition = {
        id: sid("comp"),
        title,
        categories,
        prizes,
        submissionDeadline: p.submissionDeadline ? String(p.submissionDeadline) : "",
        entryCount: 0,
        createdAt: new Date().toISOString(),
      };
      userCompetitions(STATE, userId).set(competition.id, competition);
      saveSeasonal();
      return { ok: true, result: { competition } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── competitions-list (per-user) ─────────────────────────────────
  registerLensAction("seasonal", "competitions-list", (ctx, _artifact, _params = {}) => {
    try {
      const STATE = seasonalStore();
      const userId = aid(ctx);
      const list = [...userCompetitions(STATE, userId).values()];
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { ok: true, result: { competitions: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  function cap(s) {
    const str = String(s || "");
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
