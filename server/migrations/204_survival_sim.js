// server/migrations/204_survival_sim.js
//
// Phase II Wave 20 — survival-sim hardening on top of Layer 8 pain_signals.
//
//   * Extends pain_signals.source CHECK to admit hunger / thirst / sleep
//     / cold / heat / disease as legitimate sources of pain. The existing
//     repair-cycle heartbeat already consumes the table, so these new
//     sources fold into the same recovery loop.
//   * Adds player_survival_budgets — daily-decay counters for hunger,
//     thirst, sleep, and body temperature. The survival-tick-cycle
//     advances these every 10 minutes.
//   * Adds player_diseases — active disease state with severity +
//     contagion radius. Spreads via spatial proximity per the
//     disease-contagion-cycle.

export function up(db) {
  const fkBefore  = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");

  try {
    // 1) Extend pain_signals.source CHECK. Probe-first guard.
    let needsRebuild = true;
    try {
      const probe = db.prepare(`
        INSERT INTO pain_signals (id, user_id, region, intensity, source)
        VALUES ('__probe_hunger__', '__probe__', 'systemic', 0.1, 'hunger')
      `);
      probe.run();
      db.prepare(`DELETE FROM pain_signals WHERE id = '__probe_hunger__'`).run();
      needsRebuild = false;
    } catch {
      /* rebuild */
    }

    if (needsRebuild) {
      db.exec("ALTER TABLE pain_signals RENAME TO pain_signals_v114");
      db.exec(`
        CREATE TABLE pain_signals (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL,
          world_id      TEXT,
          region        TEXT NOT NULL CHECK (region IN
                          ('head', 'torso', 'arms', 'legs', 'systemic')),
          intensity     REAL NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
          source        TEXT NOT NULL CHECK (source IN (
                          'combat', 'fall', 'environment', 'fatigue', 'spell', 'poison',
                          'hunger', 'thirst', 'sleep', 'cold', 'heat', 'disease'
                        )),
          source_id     TEXT,
          element       TEXT,
          recorded_at   INTEGER NOT NULL DEFAULT (unixepoch()),
          processed_at  INTEGER
        )
      `);
      db.exec(`
        INSERT INTO pain_signals
          (id, user_id, world_id, region, intensity, source, source_id, element, recorded_at, processed_at)
        SELECT
          id, user_id, world_id, region, intensity, source, source_id, element, recorded_at, processed_at
        FROM pain_signals_v114
      `);
      db.exec("DROP TABLE pain_signals_v114");
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pain_pending ON pain_signals(user_id, recorded_at) WHERE processed_at IS NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pain_user_recorded ON pain_signals(user_id, recorded_at DESC)`);
    }

    // 2) Per-player survival budgets.
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_survival_budgets (
        user_id            TEXT PRIMARY KEY,
        hunger             REAL NOT NULL DEFAULT 100 CHECK (hunger >= 0 AND hunger <= 100),
        thirst             REAL NOT NULL DEFAULT 100 CHECK (thirst >= 0 AND thirst <= 100),
        sleep              REAL NOT NULL DEFAULT 100 CHECK (sleep  >= 0 AND sleep  <= 100),
        body_temp_c        REAL NOT NULL DEFAULT 37   CHECK (body_temp_c >= 25 AND body_temp_c <= 45),
        last_tick_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        last_meal_at       INTEGER,
        last_drink_at      INTEGER,
        last_sleep_at      INTEGER
      )
    `);

    // 3) Active diseases. Severity 0..1; contagion_radius_m used by the
    //    contagion sweep to spread to nearby characters.
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_diseases (
        id                 TEXT PRIMARY KEY,
        user_id            TEXT NOT NULL,
        disease_id         TEXT NOT NULL,
        severity           REAL NOT NULL DEFAULT 0.1 CHECK (severity >= 0 AND severity <= 1),
        contagion_radius_m REAL NOT NULL DEFAULT 5
                              CHECK (contagion_radius_m >= 0 AND contagion_radius_m <= 50),
        contracted_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        recovered_at       INTEGER,
        symptoms_json      TEXT NOT NULL DEFAULT '[]'
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_player_diseases_active ON player_diseases (user_id, recovered_at)`);
  } finally {
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}

export const description = "Phase II Wave 20 — survival sim: hunger/thirst/sleep/temperature/disease on top of Layer 8";
