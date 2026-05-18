// server/migrations/227_social_ai.js
//
// Social lens Sprint B — AI surface substrate.
//
// The concord-native moat: instead of optimising for engagement
// (which structurally rewards rage-bait), every post gets a 5-brain
// content classification + the OOTB ranker is INVERSE-X — it boosts
// {informative, helpful, calm, learning, celebration, question} and
// tanks {rage-bait, engagement-bait, controversy}.
//
//   social_post_classifications — per-post labels from the 5-brain
//                                   classifier with confidence scores
//                                   for each axis (rage_bait,
//                                   informative, personal, etc.)
//   social_feed_algos            — user-defined ranking algorithms
//                                   (Bluesky-Attie parity). Each algo
//                                   is a weighted blend of the
//                                   classification axes + filters +
//                                   ordering hints.
//   social_feed_algo_subscribers — who's subscribed to which algo
//                                   (so authors earn from adoption)
//   social_feed_renders          — cache of computed feed orderings
//                                   per user × algo for fast read
//   social_ranking_audit         — "why am I seeing this?" surface —
//                                   per-post per-user per-algo score
//                                   breakdown
//   social_ai_runs               — append-only ledger of every AI
//                                   classification + ranker run
//                                   (provenance trail)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_post_classifications (
      post_id            TEXT PRIMARY KEY,
      classifier_version TEXT NOT NULL DEFAULT 'v1',

      -- POSITIVE axes (the inverse-X ranker amplifies these)
      informative   REAL NOT NULL DEFAULT 0,    -- 0..1: facts, links, citations, explanations
      helpful       REAL NOT NULL DEFAULT 0,    -- 0..1: actionable advice, how-tos
      learning      REAL NOT NULL DEFAULT 0,    -- 0..1: teaches the reader something
      calm          REAL NOT NULL DEFAULT 0,    -- 0..1: low arousal, reflective
      celebration   REAL NOT NULL DEFAULT 0,    -- 0..1: positive personal news, achievements
      question      REAL NOT NULL DEFAULT 0,    -- 0..1: genuine curiosity, asking for help
      personal      REAL NOT NULL DEFAULT 0,    -- 0..1: from-the-author-to-the-reader (vs broadcast)
      creative      REAL NOT NULL DEFAULT 0,    -- 0..1: art, music, fiction, design

      -- NEGATIVE axes (the inverse-X ranker tanks these)
      rage_bait     REAL NOT NULL DEFAULT 0,    -- 0..1: designed to make you angry
      engagement_bait REAL NOT NULL DEFAULT 0,  -- 0..1: "reply with X", "agree?"
      controversy   REAL NOT NULL DEFAULT 0,    -- 0..1: combative, polarising
      promotional   REAL NOT NULL DEFAULT 0,    -- 0..1: ads, self-promo, spam
      doomscroll    REAL NOT NULL DEFAULT 0,    -- 0..1: chronic crisis content

      -- META
      source        TEXT NOT NULL DEFAULT 'llm'
                    CHECK (source IN ('llm','fallback','deterministic','human')),
      tokens        INTEGER NOT NULL DEFAULT 0,
      latency_ms    INTEGER,
      reasoning     TEXT,                       -- short LLM-supplied rationale
      classified_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_spc_rage    ON social_post_classifications(rage_bait DESC) WHERE rage_bait > 0.3;
    CREATE INDEX IF NOT EXISTS idx_spc_inform  ON social_post_classifications(informative DESC) WHERE informative > 0.4;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_feed_algos (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      icon            TEXT,
      -- Weights for each axis (positive = boost, negative = tank)
      weights_json    TEXT NOT NULL,            -- {"informative": 1.0, "rage_bait": -2.0, ...}
      filters_json    TEXT,                     -- {"min_informative":0.3, "max_rage_bait":0.2, "from":"following"|"public"|"both"}
      lookback_hours  INTEGER NOT NULL DEFAULT 24,
      origin          TEXT NOT NULL DEFAULT 'human'
                      CHECK (origin IN ('human','llm','seeded')),
      llm_prompt      TEXT,                     -- the natural-language description used to generate this (Attie pattern)
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      dtu_id          TEXT,                     -- when published
      subscriber_count INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sfa_owner ON social_feed_algos(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sfa_vis   ON social_feed_algos(visibility, subscriber_count DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_feed_algo_subscribers (
      algo_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      subscribed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (algo_id, user_id),
      FOREIGN KEY (algo_id) REFERENCES social_feed_algos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sfas_user ON social_feed_algo_subscribers(user_id, is_default DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_ranking_audit (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      post_id       TEXT NOT NULL,
      algo_id       TEXT,                       -- null = OOTB inverse-X
      score         REAL NOT NULL,
      breakdown_json TEXT,                      -- {axis: contribution, ...}
      reasons_json  TEXT,                       -- human-readable: ["boosted because informative=0.85", ...]
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sra_user_post ON social_ranking_audit(user_id, post_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_ai_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT,
      post_id      TEXT,
      kind         TEXT NOT NULL                -- classify | compose_algo | rank | transparency
                   CHECK (kind IN ('classify','compose_algo','rank','transparency','translate')),
      input_text   TEXT,
      output_text  TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'llm'
                   CHECK (source IN ('llm','fallback','deterministic')),
      tokens       INTEGER NOT NULL DEFAULT 0,
      latency_ms   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sair_user ON social_ai_runs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sair_post ON social_ai_runs(post_id, kind, created_at DESC) WHERE post_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS social_ai_runs;
    DROP TABLE IF EXISTS social_ranking_audit;
    DROP TABLE IF EXISTS social_feed_algo_subscribers;
    DROP TABLE IF EXISTS social_feed_algos;
    DROP TABLE IF EXISTS social_post_classifications;
  `);
}
