// server/lib/dtu-bridge/substrate-registry.js
//
// DTU bridge — Slice 0: the substrate registry (bridge scope gate).
//
// The hybrid-storage plan (DTU bridge plan, 2026-10-14) gives Postgres
// and SQLite explicit ownership of different data classes. ONLY the DTU
// substrate class bridges: DTUs and their provenance / rights /
// citation satellites move between stores as concord-dtu-pack/v1
// envelopes. Identity/auth, the economy ledger, lens artifacts, logs
// and world/sim state stay SQLite-local — money is never dual-written,
// and nothing outside this list may enter the bridge.
//
// This module is the enforceable form of that ownership map. Every
// other bridge slice consults it before packing, queueing, or applying
// a record; a table that is not listed here is refused, by default and
// without exception.
//
// Derivation (2026-10-28): the list below was derived from the
// codebase itself — every table created by a CREATE TABLE statement in
// server/ (JS + SQL, both the IF NOT EXISTS and plain forms), plus
// dtu_archive_runs, which is defined by the archive module's queries —
// filtered to the DTU substrate class (tables whose rows ARE DTUs or
// their satellites). The original plan's live-database census counted
// 44 substrate tables; 42 are code-verifiable today. The remaining
// difference is not reproducible from code (most likely runtime or
// FTS shadow tables that exist only in the live database) — the
// registry, not the census count, is the scope the bridge enforces.
// If a substrate table is added to the codebase, add it here in the
// same change; the registry test cross-checks this list against the
// CREATE TABLE statements in server/ and fails on drift.

/** The DTU substrate class: the only tables the bridge may carry. */
export const DTU_SUBSTRATE_TABLES = Object.freeze([
  "archived_dtus",
  "canonical_registry",
  "culture_dtus",
  "dtu_archive_runs",
  "dtu_archives",
  "dtu_attachments",
  "dtu_causal_edges",
  "dtu_citations",
  "dtu_cognitive_meta",
  "dtu_compression",
  "dtu_confidence",
  "dtu_embeddings",
  "dtu_federation_history",
  "dtu_file_registry",
  "dtu_forks",
  "dtu_helpfulness",
  "dtu_integrity",
  "dtu_layer_overlays",
  "dtu_licenses",
  "dtu_operations_log",
  "dtu_ownership",
  "dtu_previews",
  "dtu_reimports",
  "dtu_repo_links",
  "dtu_review_schedule",
  "dtu_rights",
  "dtu_saved_views",
  "dtu_store",
  "dtu_store_archive",
  "dtu_surface_log",
  "dtu_sync_devices",
  "dtu_versions",
  "dtus",
  "film_crew_dtus",
  "film_dtus",
  "hermes_dtus",
  "lattice_seed_auto_dtus",
  "npc_autobiography_dtus",
  "personal_dtus",
  "private_user_kv_cache_dtus",
  "server_dtu_substrate",
  "world_substrate_dtus",
]);

const SUBSTRATE_SET = new Set(DTU_SUBSTRATE_TABLES);

/**
 * True when `table` belongs to the DTU substrate class and may cross
 * the bridge. Names are matched exactly (SQLite table names in this
 * codebase are lowercase snake_case); anything else is out of scope.
 */
export function isSubstrateTable(table) {
  return typeof table === "string" && SUBSTRATE_SET.has(table);
}

/**
 * Scope gate used by the pack, outbox, and apply slices. Throws a
 * coded error for a non-substrate table so a bridge caller can never
 * silently widen the bridge to another data class (identity, economy,
 * lens state, logs) by passing a different table name.
 */
export function assertSubstrateTable(table) {
  if (!isSubstrateTable(table)) {
    const err = new Error(
      `dtu-bridge: table "${String(table)}" is not in the DTU substrate class; the bridge carries DTU substrate tables only`
    );
    err.code = "DTU_BRIDGE_OUT_OF_SCOPE";
    err.table = table;
    throw err;
  }
  return table;
}
