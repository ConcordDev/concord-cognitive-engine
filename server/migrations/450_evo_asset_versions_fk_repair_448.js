// server/migrations/450_evo_asset_versions_fk_repair_448.js
//
// Repair the dangling foreign key migration 448 left on evo_asset_versions.
//
// 448 rebuilt evo_assets via RENAME→CREATE→DROP (evo_assets → evo_assets_v4).
// runMigrations wraps every up() in db.transaction(), where
// `PRAGMA legacy_alter_table` is a no-op, so the RENAME rewrote both child
// FKs onto evo_assets_v4 — which 448 then dropped. 448 repaired
// evo_asset_interactions in-file but not evo_asset_versions, so every
// appendVersion() threw "no such table: main.evo_assets_v4". That broke
// evo-asset.generate, POST /api/conkay/design-glb, and every other
// registerGeneratedAsset caller (the GLB was written, the registry insert
// failed). Same failure class 275 repaired after 202.
//
// 275's up() is idempotent and rebuilds any evo_asset child whose asset_id
// FK does not resolve to evo_assets, copying only rows whose asset still
// exists. Reuse it rather than duplicating the table DDL.

import { up as repairEvoAssetFks } from "./275_evo_asset_fk_repair.js";

export function up(db) {
  repairEvoAssetFks(db);
}

export function down() {
  // Forward-only: strictly corrective, no sane rollback to a dangling FK.
}

export const description = "Repair evo_asset_versions FK left dangling at evo_assets_v4 by migration 448";
