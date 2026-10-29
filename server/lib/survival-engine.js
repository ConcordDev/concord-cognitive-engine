// server/lib/survival-engine.js
//
// Phase II Wave 20 — survival sim: hunger / thirst / sleep / temperature
// / disease. Builds on the existing pain_signals + repair-cycle layer.
//
// Tick math:
//   hunger  : decays 100→0 over ~24 in-game hours of activity (-0.07/min)
//   thirst  : decays 100→0 over ~12 in-game hours (-0.14/min)
//   sleep   : decays 100→0 over ~48 hours (-0.035/min); restored by inn
//             stay (full) or ground rest (partial).
//   body_temp_c : tracks toward ambient (sourced from embodied/signals.js
//             thermal_os.ambient_temp) at +/- 0.2°C per tick.
//
// Failure modes (severity = 1 - budget/100, clamped to 0..1):
//   hunger < 30  → pain_signals(systemic, hunger) low intensity
//   hunger < 10  → pain_signals(systemic, hunger) high intensity + strength debuff
//   thirst < 20  → pain_signals(systemic, thirst) + stamina debuff
//   sleep < 25   → pain_signals(head, sleep) + focus debuff
//   body_temp_c < 35 → pain_signals(systemic, cold)
//   body_temp_c > 39 → pain_signals(systemic, heat)
//
// Diseases progress severity over time; high severity feeds pain_signals.

import crypto from "node:crypto";

export const SURVIVAL_CONSTANTS = Object.freeze({
  HUNGER_DECAY_PER_MIN: 0.07,
  THIRST_DECAY_PER_MIN: 0.14,
  SLEEP_DECAY_PER_MIN:  0.035,
  BODY_TEMP_TRACK_PER_MIN: 0.20,

  HUNGER_PAIN_THRESHOLD: 30,
  HUNGER_CRITICAL: 10,
  THIRST_PAIN_THRESHOLD: 20,
  SLEEP_PAIN_THRESHOLD:  25,
  COLD_PAIN_THRESHOLD:   35,
  HEAT_PAIN_THRESHOLD:   39,

  DISEASE_TICK_PROGRESS: 0.005,
  DISEASE_RECOVERY_BELOW_SEVERITY: 0.02,
  // Natural recovery (tickDiseases): each basic need the player has
  // actually tended recently — rested / fed / hydrated, budget at or
  // above CARE_NEED_THRESHOLD with the matching last_*_at inside
  // CARE_WINDOW_SEC — subtracts DISEASE_RECOVERY_PER_CARE from the
  // per-tick progression. Full care (3 needs) outweighs progression
  // (3 × 0.004 > 0.005), so a cared-for disease drifts down and can
  // recover from any severity; neglect progresses exactly as before.
  DISEASE_RECOVERY_PER_CARE: 0.004,
  CARE_NEED_THRESHOLD: 60,
  CARE_WINDOW_SEC: 3600,
});

/* ───────── Budgets ─────────────────────────────────────────────────── */

export function ensureBudget(db, userId) {
  if (!userId) throw new Error("userId required");
  let row = db.prepare("SELECT * FROM player_survival_budgets WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare(`
      INSERT INTO player_survival_budgets (user_id) VALUES (?)
    `).run(userId);
    row = db.prepare("SELECT * FROM player_survival_budgets WHERE user_id = ?").get(userId);
  }
  return row;
}

export function getBudget(db, userId) {
  return db.prepare("SELECT * FROM player_survival_budgets WHERE user_id = ?").get(userId) || null;
}

/* ───────── Tick (called by heartbeat) ──────────────────────────────── */

/**
 * Advance one player's budgets. Caller passes the current ambient temp
 * in °C (read from embodied/signals.js) or null when unknown.
 *
 * Returns { delta, newBudget, painEvents[] } so a per-player UI can
 * show "you just got hungry" toasts.
 */
export function tickSurvival(db, userId, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const budget = ensureBudget(db, userId);
  const lastTickAt = Number(budget.last_tick_at) || now;
  const minutesElapsed = Math.max(0, (now - lastTickAt) / 60);
  if (minutesElapsed <= 0.001) {
    return { delta: { minutesElapsed: 0 }, newBudget: budget, painEvents: [] };
  }
  const K = SURVIVAL_CONSTANTS;
  const ambientC = typeof opts.ambientTempC === "number" ? opts.ambientTempC : 20;

  const newHunger = Math.max(0, budget.hunger - K.HUNGER_DECAY_PER_MIN * minutesElapsed);
  const newThirst = Math.max(0, budget.thirst - K.THIRST_DECAY_PER_MIN * minutesElapsed);
  const newSleep  = Math.max(0, budget.sleep  - K.SLEEP_DECAY_PER_MIN  * minutesElapsed);
  // Body temp tracks ambient with cap on rate per tick
  const tempDelta = Math.sign(ambientC - budget.body_temp_c) *
                    Math.min(Math.abs(ambientC - budget.body_temp_c), K.BODY_TEMP_TRACK_PER_MIN * minutesElapsed);
  const newBodyTemp = Math.max(25, Math.min(45, budget.body_temp_c + tempDelta));

  const painEvents = [];
  const recordPain = (region, source, intensity) => {
    const id = crypto.randomBytes(8).toString("hex");
    db.prepare(`
      INSERT INTO pain_signals (id, user_id, region, intensity, source, recorded_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, userId, region, intensity, source);
    painEvents.push({ region, source, intensity });
  };

  if (newHunger < K.HUNGER_CRITICAL) {
    recordPain("systemic", "hunger", 0.7);
  } else if (newHunger < K.HUNGER_PAIN_THRESHOLD) {
    recordPain("systemic", "hunger", 0.25);
  }
  if (newThirst < K.THIRST_PAIN_THRESHOLD) {
    recordPain("systemic", "thirst", newThirst < 10 ? 0.6 : 0.3);
  }
  if (newSleep < K.SLEEP_PAIN_THRESHOLD) {
    recordPain("head", "sleep", newSleep < 10 ? 0.55 : 0.25);
  }
  if (newBodyTemp < K.COLD_PAIN_THRESHOLD) {
    recordPain("systemic", "cold", (K.COLD_PAIN_THRESHOLD - newBodyTemp) / 10);
  } else if (newBodyTemp > K.HEAT_PAIN_THRESHOLD) {
    recordPain("systemic", "heat", (newBodyTemp - K.HEAT_PAIN_THRESHOLD) / 10);
  }

  db.prepare(`
    UPDATE player_survival_budgets
       SET hunger = ?, thirst = ?, sleep = ?, body_temp_c = ?, last_tick_at = ?
     WHERE user_id = ?
  `).run(newHunger, newThirst, newSleep, newBodyTemp, now, userId);

  return {
    delta: {
      minutesElapsed,
      hunger:    newHunger - budget.hunger,
      thirst:    newThirst - budget.thirst,
      sleep:     newSleep  - budget.sleep,
      bodyTempC: newBodyTemp - budget.body_temp_c,
    },
    newBudget: {
      ...budget,
      hunger: newHunger, thirst: newThirst, sleep: newSleep,
      body_temp_c: newBodyTemp, last_tick_at: now,
    },
    painEvents,
  };
}

/* ───────── Restoration ─────────────────────────────────────────────── */

export function eat(db, userId, nutritionValue) {
  const value = Math.max(0, Math.min(100, Number(nutritionValue) || 30));
  const budget = ensureBudget(db, userId);
  const newHunger = Math.min(100, budget.hunger + value);
  db.prepare(`
    UPDATE player_survival_budgets
       SET hunger = ?, last_meal_at = unixepoch()
     WHERE user_id = ?
  `).run(newHunger, userId);
  return { ok: true, oldHunger: budget.hunger, newHunger, gained: newHunger - budget.hunger };
}

export function drink(db, userId, hydrationValue) {
  const value = Math.max(0, Math.min(100, Number(hydrationValue) || 40));
  const budget = ensureBudget(db, userId);
  const newThirst = Math.min(100, budget.thirst + value);
  db.prepare(`
    UPDATE player_survival_budgets
       SET thirst = ?, last_drink_at = unixepoch()
     WHERE user_id = ?
  `).run(newThirst, userId);
  return { ok: true, oldThirst: budget.thirst, newThirst, gained: newThirst - budget.thirst };
}

/**
 * Sleep restores the sleep budget. quality: 'inn' (full restore over time),
 * 'ground' (partial), 'cot' (medium).
 */
export function sleepRestore(db, userId, quality = "ground", minutes = 60) {
  const m = Math.max(1, Math.min(720, Number(minutes) || 60));
  const restorePerMinute = quality === "inn" ? 1.5 : quality === "cot" ? 1.0 : 0.5;
  const budget = ensureBudget(db, userId);
  const newSleep = Math.min(100, budget.sleep + restorePerMinute * m);
  db.prepare(`
    UPDATE player_survival_budgets
       SET sleep = ?, last_sleep_at = unixepoch()
     WHERE user_id = ?
  `).run(newSleep, userId);
  return { ok: true, oldSleep: budget.sleep, newSleep, gained: newSleep - budget.sleep, quality, minutes: m };
}

/* ───────── Diseases ────────────────────────────────────────────────── */

export function contractDisease(db, userId, diseaseId, opts = {}) {
  const existing = db.prepare(`
    SELECT id FROM player_diseases WHERE user_id = ? AND disease_id = ? AND recovered_at IS NULL
  `).get(userId, diseaseId);
  if (existing) return { ok: true, alreadyContracted: true, id: existing.id };
  const id = crypto.randomBytes(8).toString("hex");
  db.prepare(`
    INSERT INTO player_diseases (id, user_id, disease_id, severity, contagion_radius_m, symptoms_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, diseaseId,
    Math.max(0.05, Math.min(1, Number(opts.severity) || 0.1)),
    Math.max(0, Math.min(50, Number(opts.contagionRadiusM) || 5)),
    JSON.stringify(opts.symptoms || []),
  );
  return { ok: true, id };
}

/**
 * How many of the three basic needs the player has actually tended
 * recently, read from their survival budget: rested (sleep budget at
 * threshold + slept within the care window), fed (hunger + ate
 * recently), hydrated (thirst + drank recently). A need counts only
 * when BOTH the budget is currently up AND the care action is recent —
 * a full bar from long ago is not care within the tick window. No
 * budget row (or a missing timestamp) counts as no care.
 */
export function careScore(db, userId, nowSec = Math.floor(Date.now() / 1000)) {
  const budget = getBudget(db, userId);
  if (!budget) return 0;
  const K = SURVIVAL_CONSTANTS;
  const recent = (ts) => ts != null && nowSec - Number(ts) <= K.CARE_WINDOW_SEC;
  let score = 0;
  if (budget.sleep >= K.CARE_NEED_THRESHOLD && recent(budget.last_sleep_at)) score++;
  if (budget.hunger >= K.CARE_NEED_THRESHOLD && recent(budget.last_meal_at)) score++;
  if (budget.thirst >= K.CARE_NEED_THRESHOLD && recent(budget.last_drink_at)) score++;
  return score;
}

export function tickDiseases(db, userId) {
  const active = db.prepare(`
    SELECT id, disease_id, severity FROM player_diseases
    WHERE user_id = ? AND recovered_at IS NULL
  `).all(userId);
  const events = [];
  const markRecovered = db.prepare("UPDATE player_diseases SET recovered_at = unixepoch() WHERE id = ?");
  const setSeverity = db.prepare("UPDATE player_diseases SET severity = ? WHERE id = ?");
  const insPain = db.prepare(`
        INSERT INTO pain_signals (id, user_id, region, intensity, source, recorded_at)
        VALUES (?, ?, 'systemic', ?, 'disease', unixepoch())
      `);
  // Natural recovery keys off the care the player actually took within
  // the window (rest / food / water — see careScore). Medicine is the
  // other half and already lives in curePartial: it cuts severity
  // directly, and sustained care then carries the disease the rest of
  // the way to recovered instead of the old stub rule, where recovery
  // was an accident of starting below the threshold and severity
  // otherwise only ever rose.
  const care = careScore(db, userId);
  const drift = SURVIVAL_CONSTANTS.DISEASE_TICK_PROGRESS
    - care * SURVIVAL_CONSTANTS.DISEASE_RECOVERY_PER_CARE;
  for (const d of active) {
    let next = d.severity + drift;
    if (next < SURVIVAL_CONSTANTS.DISEASE_RECOVERY_BELOW_SEVERITY) {
      markRecovered.run(d.id);
      events.push({ kind: "recovered", id: d.id, diseaseId: d.disease_id, care });
      continue;
    }
    next = Math.max(0, Math.min(1, next));
    setSeverity.run(next, d.id);
    if (next < d.severity) {
      events.push({ kind: "improving", id: d.id, diseaseId: d.disease_id, severity: next, care });
    }
    // Pain signal at high severity
    if (next > 0.5) {
      const id = crypto.randomBytes(8).toString("hex");
      insPain.run(id, userId, Math.min(1, next));
      events.push({ kind: "pain", id: d.id, intensity: next });
    }
  }
  return events;
}

export function listActiveDiseases(db, userId) {
  return db.prepare(`
    SELECT * FROM player_diseases WHERE user_id = ? AND recovered_at IS NULL ORDER BY contracted_at DESC
  `).all(userId);
}

export function curePartial(db, userId, diseaseId, severityReduction) {
  const r = db.prepare(`
    UPDATE player_diseases
       SET severity = MAX(0, severity - ?)
     WHERE user_id = ? AND disease_id = ? AND recovered_at IS NULL
  `).run(Math.max(0, Math.min(1, Number(severityReduction) || 0.2)), userId, diseaseId);
  return { ok: r.changes > 0 };
}
