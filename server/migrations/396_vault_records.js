// server/migrations/396_vault_records.js
//
// TheVault — a curated archive. People submit creative work, HUMAN curators
// admit or decline it, and admitted works become permanent records.
//
// ── Why this is DB-backed, and not an in-memory Map ──────────────────────
//
// Migration 385's header (conkay_authored_tools) draws the line this table
// sits on the same side of: `server/lib/repair-remediation.js` can hold its
// proposed -> approved|rejected -> revoked queue in an in-memory Map ONLY
// because every candidate in it RE-DERIVES from a live detector sweep on the
// next boot — losing the Map loses nothing that cannot be recomputed.
//
// A Vault admission is the exact opposite. A curator's "I accepted this
// because…" is a one-and-only human authorship event. It re-derives from
// NOTHING — no sweep, no detector, no model can regenerate the sentence a
// person wrote about why a work mattered. It is read indefinitely, across
// restarts, by everyone who later encounters the record. So the state
// machine MUST be durable, exactly like 385's, and for the same stated
// reason.
//
// ── State machine ────────────────────────────────────────────────────────
//
//   submitted -> under_review -> admitted | declined
//   submitted | under_review -> withdrawn        (submitter-initiated)
//
// Terminal in all three of admitted / declined / withdrawn. Mirrors 385's
// column conventions throughout: a `status` CHECK constraint, and paired
// `*_at` / `*_by` / `*_reason` columns per transition.
//
// ── The four hard invariants, and where each is enforced ─────────────────
//
// 1. NO ADMISSION WITHOUT A NON-EMPTY, HUMAN-AUTHORED CURATOR STATEMENT.
//    Enforced HERE, at the storage layer, by the table-level
//    `chk_vault_admission_requires_human` CHECK below — not only in the lib.
//    No code path in this repo, present or future, including a raw
//    `UPDATE vault_submissions SET status='admitted'`, can produce an
//    admitted row without a non-blank statement and a named curator. This
//    is deliberately stronger than a lib-layer guard: the statement is the
//    product's sacred artifact, so SQLite itself refuses the alternative.
//
//    Note this is a genuinely NEW column shape for this codebase. Every
//    existing governance table (385's conkay_authored_tools, 379's
//    agent_marathon_sessions, 344's creative_usage_licenses) carries only a
//    *reject* reason — a rationale for the NO. There is no accept-rationale
//    field anywhere to copy. TheVault inverts that: the YES is the thing
//    that has to be argued for, and the NO is the thing kept private.
//
// 2. EVERY ADMISSION CARRIES A NAMED HUMAN CURATOR.
//    `admitted_by` + `admitted_by_role` are inside the same CHECK, and
//    `admitted_by_role` is constrained to the two HUMAN roles that exist in
//    `vault_curators` — there is no machine role, by design. Machine-
//    assembled evidence lives in its OWN column, `machine_evidence_json`,
//    which is explicitly excluded from the CHECK: a row with rich machine
//    evidence and a blank `curator_statement` is rejected by SQLite. Two
//    separate columns, one of which can never stand in for the other.
//    "AI helps organize evidence. Humans preserve culture."
//
// 3. DECLINES ARE PRIVATE.
//    `decline_reason` is stored, never published. Enforcement is a read-path
//    property, so it lives in `server/domains/vault.js` (`browse` /
//    `publicRecord` hard-code `status = 'admitted'` and accept no status
//    parameter). The index below deliberately supports the curator-scoped
//    queue rather than any public "rejected" listing — there is no index,
//    view, or column here that would make a public rejection list cheap,
//    because there must never be one.
//
// 4. GUEST-CURATOR ATTRIBUTION.
//    `vault_curators` distinguishes `founding_curator` from
//    `guest_curator`, and its `chk_vault_guest_needs_inviter` CHECK forces a
//    guest to carry the id of whoever invited them. An admission stamps the
//    ACTING curator into `admitted_by` — a guest's induction is attributed
//    to the guest, with the founder visible only as `invited_by` on the
//    curator record.
//
// Plain TEXT foreign keys with no SQL FOREIGN KEY constraint, matching this
// repo's established convention (migration 385's owner_user_id, 384's
// notebooks, 378's goal_tree_id) — referential validity is checked in the
// domain layer, which reports a dangling reference honestly rather than
// fabricating one.
//
// The Vault opens EMPTY. This migration seeds no curator, no submission and
// no record — a founding curator is installed by a real human action
// (`vault.install_founding_curator`), and inventing sample entries in an
// archive whose entire value is that a person vouched for each one would be
// the platform's zero-demo-content invariant violated at its worst.
//
// Append-only; IF NOT EXISTS so re-runs (and minimal/partial builds) are
// safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_curators (
      curator_id     TEXT PRIMARY KEY,
      display_name   TEXT NOT NULL,
      role           TEXT NOT NULL CHECK (role IN ('founding_curator','guest_curator')),
      invited_by     TEXT,
      invited_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      retired_at     INTEGER,
      retire_reason  TEXT,

      -- Invariant 4: a guest curator is always traceable to the human who
      -- invited them. Only the founding curator may have no inviter.
      CONSTRAINT chk_vault_guest_needs_inviter
        CHECK (role = 'founding_curator' OR (invited_by IS NOT NULL AND trim(invited_by) <> ''))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_submissions (
      id                     TEXT PRIMARY KEY,
      submitter_id           TEXT NOT NULL,
      title                  TEXT NOT NULL,
      work_kind              TEXT NOT NULL DEFAULT 'other'
                                  CHECK (work_kind IN ('writing','music','visual','moving_image','code','performance','other')),
      description            TEXT NOT NULL DEFAULT '',
      body                   TEXT NOT NULL DEFAULT '',
      source_dtu_id          TEXT,

      -- Declared derivation. Named 'lineage' (never 'parents') to match the
      -- ONLY dtu.create field that actually drives the royalty cascade and
      -- the usage-rights consent gate — see server/domains/vault.js's header.
      lineage_json           TEXT NOT NULL DEFAULT '[]',

      status                 TEXT NOT NULL DEFAULT 'submitted'
                                  CHECK (status IN ('submitted','under_review','admitted','declined','withdrawn')),

      submitted_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      review_opened_at       INTEGER,
      review_opened_by       TEXT,

      -- Invariant 1: the sacred artifact. Human prose, written by a person,
      -- about why this work belongs in the archive.
      curator_statement      TEXT,
      curator_statement_by   TEXT,

      -- Invariant 2: machine-assembled evidence, in its OWN explicitly
      -- labeled column. Deliberately absent from the admission CHECK below,
      -- so it can never satisfy the human decision field no matter how
      -- complete it is.
      machine_evidence_json  TEXT,

      admitted_at            INTEGER,
      admitted_by            TEXT,
      admitted_by_role       TEXT CHECK (admitted_by_role IS NULL OR admitted_by_role IN ('founding_curator','guest_curator')),
      record_dtu_id          TEXT,

      -- Hook for the separately-owned permanence/pinning unit. Admission
      -- leaves this NULL and reports protection as un-applied rather than
      -- stamping a flag nothing honours yet; see
      -- server/domains/vault.js#setAdmissionProtectionHandler.
      protection_flags_json  TEXT,

      -- Invariant 3: stored for the curator-scoped path only. Never
      -- surfaced by browse()/publicRecord().
      declined_at            INTEGER,
      declined_by            TEXT,
      decline_reason         TEXT,

      withdrawn_at           INTEGER,
      withdraw_reason        TEXT,

      -- Invariants 1 + 2, enforced by SQLite itself: an 'admitted' row is
      -- structurally impossible without non-blank human prose AND a named
      -- human curator in a known human role. machine_evidence_json is
      -- pointedly not part of this condition.
      CONSTRAINT chk_vault_admission_requires_human
        CHECK (
          status <> 'admitted' OR (
            curator_statement    IS NOT NULL AND trim(curator_statement)    <> ''
            AND curator_statement_by IS NOT NULL AND trim(curator_statement_by) <> ''
            AND admitted_by      IS NOT NULL AND trim(admitted_by)          <> ''
            AND admitted_by_role IS NOT NULL
            AND curator_statement_by = admitted_by
          )
        )
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_submissions_status ON vault_submissions(status, submitted_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_submissions_submitter ON vault_submissions(submitter_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_submissions_curator ON vault_submissions(admitted_by) WHERE admitted_by IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_submissions_record ON vault_submissions(record_dtu_id) WHERE record_dtu_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vault_curators_active ON vault_curators(active, role)`);
}

export function down(_db) { /* sqlite — append-only convention; leave tables in place */ }
