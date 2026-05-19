// server/migrations/245_wallet_moats.js
//
// Wallet lens Sprint C — concord-native moats.
//
// RESEARCH GROUNDING (May 2026):
//   - Patreon Aug 2025: collapsed to flat 10% platform fee for new
//     creators + 2.9% processing. Ko-fi: 0% one-time / 5% memberships.
//     BMC: 5% flat. ALL add 2.9% + $0.30 processing.
//   - CONCORD MOAT: 0% platform + 0% processing on Concord Coin
//     internal tips (no external processor needed). Patreon-killer
//     pricing for the Concord-native creator economy.
//   - Plaid sells multi-rail routing (ACH + FedNow + RTP + Same Day
//     ACH) as a product. Concord matches.
//   - Open banking + 21st Century Cures Act parallel: user owns
//     their data. Concord's DTU substrate IS the portable export.

export function up(db) {
  // wallet_transaction_mints — per-transaction receipt DTU
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transaction_mints (
      transaction_id  TEXT PRIMARY KEY,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,                       -- who minted (= owner)
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public')),
      tax_year        INTEGER,                              -- denormed for tax-prep export
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (transaction_id) REFERENCES wallet_transactions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wtm_creator ON wallet_transaction_mints(creator_id, minted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wtm_tax_year ON wallet_transaction_mints(creator_id, tax_year) WHERE tax_year IS NOT NULL;
  `);

  // wallet_creator_tips — Concord-native creator tipping with content cite
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_creator_tips (
      id              TEXT PRIMARY KEY,
      tipper_user_id  TEXT NOT NULL,
      recipient_user_id TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      rail            TEXT NOT NULL DEFAULT 'concord_coin'  -- 'concord_coin','usd_ach','usd_fednow','usd_rtp','stripe_card','usdc'
                      CHECK (rail IN ('concord_coin','usd_ach','usd_fednow','usd_rtp','stripe_card','usdc')),
      platform_fee_cents INTEGER NOT NULL DEFAULT 0,       -- 0 for Concord Coin internal (moat)
      processing_fee_cents INTEGER NOT NULL DEFAULT 0,     -- 0 for Concord Coin internal
      cited_content_dtu_id TEXT,                            -- e.g. the song this tip rewards
      cited_content_kind TEXT,                              -- 'music_track','social_post','doc','etc'
      message         TEXT,
      anonymous       INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
      transaction_id  TEXT,                                 -- back-ref to wallet_transactions when settled
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      paid_at         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wct_tipper ON wallet_creator_tips(tipper_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wct_recipient ON wallet_creator_tips(recipient_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wct_content ON wallet_creator_tips(cited_content_dtu_id) WHERE cited_content_dtu_id IS NOT NULL;
  `);

  // wallet_rail_routes — audit of routing decisions for outbound payments
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_rail_routes (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      destination_kind TEXT NOT NULL                       -- 'concord_user','external_bank','crypto_address','merchant','provider'
                      CHECK (destination_kind IN ('concord_user','external_bank','crypto_address','merchant','provider')),
      destination_ref TEXT,
      amount_cents    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      candidates_json TEXT NOT NULL,                       -- [{rail, fee_cents, eta_seconds, score}]
      selected_rail   TEXT NOT NULL
                      CHECK (selected_rail IN ('concord_coin','usd_ach','usd_fednow','usd_rtp','stripe_card','usdc','same_day_ach')),
      selected_fee_cents INTEGER NOT NULL DEFAULT 0,
      selected_eta_seconds INTEGER,
      reasoning       TEXT,
      executed        INTEGER NOT NULL DEFAULT 0,
      transaction_id  TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wrr_owner ON wallet_rail_routes(owner_user_id, created_at DESC);
  `);

  // wallet_export_bundles — open-banking-style export
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_export_bundles (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      format          TEXT NOT NULL                        -- 'concord_dtu_pack','ofx','csv','qif','json'
                      CHECK (format IN ('concord_dtu_pack','ofx','csv','qif','json')),
      scope_kind      TEXT NOT NULL                        -- 'all','date_range','single_account','tax_year','category'
                      CHECK (scope_kind IN ('all','date_range','single_account','tax_year','category')),
      scope_json      TEXT,                                -- {start_ts, end_ts, account_id, tax_year, category}
      record_count    INTEGER NOT NULL DEFAULT 0,
      payload         TEXT NOT NULL,                       -- serialized bundle (or URL hint for larger)
      target_app      TEXT,                                -- 'mint','quicken','turbo_tax','manual_download','custom'
      status          TEXT NOT NULL DEFAULT 'ready'
                      CHECK (status IN ('pending','building','ready','delivered','expired')),
      expires_at      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_web_owner ON wallet_export_bundles(owner_user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS wallet_export_bundles;
    DROP TABLE IF EXISTS wallet_rail_routes;
    DROP TABLE IF EXISTS wallet_creator_tips;
    DROP TABLE IF EXISTS wallet_transaction_mints;
  `);
}
