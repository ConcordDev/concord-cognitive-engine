// server/migrations/370_creation_singularity_arenas.js
//
// P-D — Creation Singularity: a NON-MONETARY fork-vs-fork tournament arena
// over the existing lattice-fork sandboxes (lib/lattice-fork.js, mig 351
// fork_objects). Entrants are confined sandboxes (instantiateForkSandbox) —
// never money, never wallets, never CC. Distinct from the PvP
// server/domains/tournaments.js + mig 103/360 bracket toolkits: those model
// live players fighting for a prize_pool_cc; this models a deterministic,
// server-computed bracket over already-confined AI-fork objects, scored by
// a real deterministic synthesis-quality signal, and payable in exactly one
// currency — a citable result DTU.
//
//   id                 PK ("csa_<hex>")
//   owner_user_id      the human who owns EVERY entrant fork (self-fork
//                       tournaments only — see server/lib/creation-singularity.js
//                       for why cross-owner entrants are out of scope)
//   title              arena title
//   fork_ids_json      the bounded set of fork_objects.id entrants (>=2)
//   bracket_json       array of rounds; each round is an array of match
//                       objects { round, slot, forkAId, forkBId, winnerId,
//                       scoreA, scoreB, status, tiebreak }
//   status             in_progress | completed | cancelled
//   champion_fork_id   winning fork_objects.id once completed
//   result_dtu_id      the citable result DTU minted on completion (the
//                       ONLY reward — no prize_pool_cc column exists here,
//                       intentionally, unlike mig 103/360)
//   log_json           human-readable event log
//   created_at         unix seconds
//   completed_at       unix seconds, null until completed
//
// Forward-only; table-guarded (server/lib/creation-singularity.js checks
// tableExists before every query, same idiom as lib/lattice-fork.js).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creation_singularity_arenas (
      id                TEXT PRIMARY KEY,
      owner_user_id     TEXT NOT NULL,
      title             TEXT NOT NULL DEFAULT 'Untitled Arena',
      fork_ids_json     TEXT NOT NULL DEFAULT '[]',
      bracket_json      TEXT NOT NULL DEFAULT '[]',
      status            TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','completed','cancelled')),
      champion_fork_id  TEXT,
      result_dtu_id     TEXT,
      log_json          TEXT NOT NULL DEFAULT '[]',
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_csa_owner  ON creation_singularity_arenas(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_csa_status ON creation_singularity_arenas(status);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS creation_singularity_arenas;`);
}
