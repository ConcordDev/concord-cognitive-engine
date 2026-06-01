// server/migrations/322_extraction_loans.js
//
// Extraction-by-rescue (Sere / the Mercy Fund). "We are here to help. We only ask
// for everything." A rescue loan whose conditions transfer the collateral asset to
// the lender on default. The debt-trap is a thing you can WATCH happen to an NPC
// realm (or to Pell's tea-house) — the Ledger lens surfaces the lien chain.
//
// Scoped by world_id (only acts on Sere). Builds on realms.treasury +
// world_buildings.owner_id; no new wallet primitives.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_loans (
      id             TEXT PRIMARY KEY,
      world_id       TEXT NOT NULL,
      debtor_kind    TEXT NOT NULL CHECK (debtor_kind IN ('realm','npc')),
      debtor_id      TEXT NOT NULL,
      creditor_id    TEXT NOT NULL,           -- the rescuer (e.g. the_mercy_fund)
      amount         INTEGER NOT NULL DEFAULT 0,
      conditions     TEXT,                     -- human-readable 'we only ask for everything'
      collateral_kind TEXT CHECK (collateral_kind IN ('building','none')),
      collateral_id  TEXT,                     -- world_buildings.id transferred on default
      status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','defaulted')),
      due_at         INTEGER NOT NULL,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_extraction_loans_world ON extraction_loans(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_extraction_loans_due ON extraction_loans(status, due_at);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS extraction_loans;`);
}
