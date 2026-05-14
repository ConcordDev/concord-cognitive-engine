// server/migrations/186_war_campaigns.js
//
// In-world war substrate. Layers on top of faction-strategy's
// DECLARE_WAR move so that when a realm declares war the result is a
// real 3D-playable campaign — rally points, troop rosters, skirmish
// ticks, captured towns, kidnapped NPCs.
//
// Tables:
//   war_campaigns       — one row per active war (attacker_realm vs
//                          defender_realm + target_territory)
//   war_troops          — roster of user + NPC participants per
//                          campaign per side
//   war_skirmishes      — append-only log of skirmish ticks
//                          (resolved per-tick by war-skirmish-cycle)
//   war_kidnaps         — NPCs captured during a campaign (released
//                          on peace OR by ransom payment)
//   war_town_captures   — territories that changed hands

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS war_campaigns (
      id                  TEXT PRIMARY KEY,
      world_id            TEXT NOT NULL,
      attacker_realm_id   TEXT NOT NULL,
      defender_realm_id   TEXT NOT NULL,
      target_territory    TEXT NOT NULL,
      rally_x             REAL,
      rally_z             REAL,
      state               TEXT NOT NULL DEFAULT 'declared'
                              CHECK (state IN
                                ('declared', 'mustering', 'marching',
                                 'engaging', 'occupying', 'won',
                                 'lost', 'truced')),
      attacker_morale     INTEGER NOT NULL DEFAULT 60
                              CHECK (attacker_morale BETWEEN 0 AND 100),
      defender_morale     INTEGER NOT NULL DEFAULT 70
                              CHECK (defender_morale BETWEEN 0 AND 100),
      attacker_troops     INTEGER NOT NULL DEFAULT 0,
      defender_troops     INTEGER NOT NULL DEFAULT 0,
      casus_belli         TEXT,
      declared_by         TEXT,
      declared_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      next_skirmish_at    INTEGER,
      resolved_at         INTEGER,
      outcome             TEXT
                              CHECK (outcome IS NULL OR outcome IN
                                ('attacker_victory', 'defender_victory',
                                 'stalemate_truce', 'cancelled'))
    );
    CREATE INDEX IF NOT EXISTS idx_war_campaigns_world  ON war_campaigns(world_id, state);
    CREATE INDEX IF NOT EXISTS idx_war_campaigns_next   ON war_campaigns(next_skirmish_at)
                                                       WHERE resolved_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS war_troops (
      campaign_id      TEXT NOT NULL,
      side             TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
      participant_kind TEXT NOT NULL CHECK (participant_kind IN ('player', 'npc')),
      participant_id   TEXT NOT NULL,
      role             TEXT NOT NULL DEFAULT 'soldier'
                            CHECK (role IN ('soldier', 'commander', 'support', 'scout')),
      hp               INTEGER NOT NULL DEFAULT 100,
      joined_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      departed_at      INTEGER,
      PRIMARY KEY (campaign_id, participant_kind, participant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_war_troops_campaign ON war_troops(campaign_id, side);
    CREATE INDEX IF NOT EXISTS idx_war_troops_actor    ON war_troops(participant_kind, participant_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS war_skirmishes (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL,
      x               REAL,
      z               REAL,
      attacker_losses INTEGER NOT NULL DEFAULT 0,
      defender_losses INTEGER NOT NULL DEFAULT 0,
      morale_swing    INTEGER NOT NULL DEFAULT 0,
      summary         TEXT,
      occurred_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_war_skirmishes_campaign ON war_skirmishes(campaign_id, occurred_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS war_kidnaps (
      id            TEXT PRIMARY KEY,
      campaign_id   TEXT,
      captor_kind   TEXT NOT NULL CHECK (captor_kind IN ('player', 'npc', 'realm')),
      captor_id     TEXT NOT NULL,
      victim_kind   TEXT NOT NULL CHECK (victim_kind IN ('npc', 'player')),
      victim_id     TEXT NOT NULL,
      held_at       TEXT,
      ransom_cc     INTEGER NOT NULL DEFAULT 100,
      captured_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      released_at   INTEGER,
      release_reason TEXT
                          CHECK (release_reason IS NULL OR release_reason IN
                            ('ransom_paid', 'escape', 'truce', 'execution', 'rescue'))
    );
    CREATE INDEX IF NOT EXISTS idx_war_kidnaps_victim ON war_kidnaps(victim_kind, victim_id);
    CREATE INDEX IF NOT EXISTS idx_war_kidnaps_active ON war_kidnaps(released_at)
                                                      WHERE released_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS war_town_captures (
      id            TEXT PRIMARY KEY,
      campaign_id   TEXT NOT NULL,
      territory_id  TEXT NOT NULL,
      from_realm_id TEXT NOT NULL,
      to_realm_id   TEXT NOT NULL,
      captured_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_town_captures_terr ON war_town_captures(territory_id);
  `);
}

export function down(_db) {
  // Forward-only.
}
