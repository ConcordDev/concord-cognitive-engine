// Migration 123 — Drop dead tables from migrations 044, 052, 056 (Phase 4).
//
// - creation_diffusion (mig 044): superseded by promotion-pipeline +
//   breakthrough-clusters substrate.
// - guilds, guild_members (mig 052): superseded by orgs substrate
//   (organizations + faction subsystem).
// - messaging_verification_codes (mig 056): superseded by JWT short-lived
//   tokens directly in the auth flow.

import { dropDeadTables } from "./_drop-with-rescue.js";

export function up(db) {
  const result = dropDeadTables(db, [
    "creation_diffusion",
    "guilds",
    "guild_members",
    "messaging_verification_codes",
  ]);
  if (!result.ok) console.warn("[migration 123]", result);
}

export function down(_db) { /* forward-only */ }
