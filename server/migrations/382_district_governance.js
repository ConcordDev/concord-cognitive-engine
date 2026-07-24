// server/migrations/382_district_governance.js
//
// Player-influenced districts — governance layer alongside the read-only
// districts table (migration 374, server/lib/districts.js).
//
// V1.2 Wave D grounding audit found districts.js purely server-authored and
// read-only: seedDefaultDistricts hardcodes 6 districts for concordia-hub,
// and every export (listDistricts/getDistrict/districtAt) only reads. Zero
// player-write path existed anywhere. This migration adds the proposal +
// vote substrate a governance layer needs; it does NOT alter the `districts`
// table's schema or districts.js's read path — an accepted proposal writes
// through the EXISTING `palette_json` / `lighting_tag` columns using plain
// UPDATE statements (see server/lib/district-governance.js), so
// getDistrict()/listDistricts() reflect the change with zero code changes
// to districts.js itself.
//
// Tables:
//   district_proposals — one row per proposed change. `kind` is either
//     'identity_tag' (writes districts.lighting_tag — the existing "vibe/
//     identity" field districts.js already surfaces as `lightingTag`) or
//     'palette_shift' (merges into districts.palette_json, surfaced as
//     `palette`). `proposed_value` is a JSON-encoded string/object.
//     `status` starts 'pending' and is resolved to 'accepted' / 'rejected' /
//     'expired' by resolveDistrictProposals() — never silently applied.
//   district_votes — one row per (proposal, voter). PRIMARY KEY on
//     (proposal_id, user_id) is the UNIQUE constraint that makes a second
//     vote from the same user a no-op rejection, not a double-count.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS district_proposals (
      id                TEXT PRIMARY KEY,
      district_id       TEXT NOT NULL,
      proposer_user_id  TEXT NOT NULL,
      kind              TEXT NOT NULL CHECK (kind IN ('identity_tag', 'palette_shift')),
      proposed_value    TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      resolves_at       INTEGER NOT NULL,
      resolved_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_district_proposals_district ON district_proposals(district_id, status);
    CREATE INDEX IF NOT EXISTS idx_district_proposals_pending  ON district_proposals(status, resolves_at);

    CREATE TABLE IF NOT EXISTS district_votes (
      proposal_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      vote         TEXT NOT NULL CHECK (vote IN ('for', 'against')),
      cast_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (proposal_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_district_votes_proposal ON district_votes(proposal_id);
  `);
}

export const description = "Player-influenced districts: proposal + vote substrate (district_proposals, district_votes) resolving through districts.js's existing palette_json/lighting_tag columns";
