// @sync-fs-ok: `writePromotedContent` writes the four world-content files
// (meta/npcs/factions/lore) as one coherent set for a low-frequency, admin-
// initiated promotion — the same shape as `foundry-publisher.js`'s annotated
// publish-time write. Sync keeps the four writes ordered and un-interleaved
// with any other promotion targeting the same directory.
// server/lib/foundry/promote.js
//
// Foundry — Promotion (closes the compiler.js TODO: "'Promotion' to a
// full first-class world node (persisted seed content) is a later
// flag").
//
// A published Foundry world is, today, an OVERLAY: a real `worlds` row
// driven entirely by compiled physics_modulators/rule_modulators (see
// compiler.js). It never gets an authored content/world/<id>/
// directory, so it can't carry named NPCs/factions/lore the way every
// hand-authored sub-world does, and content-seeder.js#discoverSubWorlds()
// never sees it.
//
// This module is the missing PROMOTE step: given an already-published
// Foundry world, generate a real content/world/<publishedWorldId>/
// {meta,npcs,factions,lore}.json directory so the world becomes a full
// first-class node the next time the content-seeder runs. It is
// explicitly OPT-IN — see server/domains/foundry.js's `foundry.promote`
// macro, the only caller. Nothing here runs automatically on publish;
// every existing publish/compile/preview/marketplace code path is
// untouched.
//
// Content generation reuses scripts/scaffold-world.mjs's template
// functions (metaTemplate/npcTemplate/factionTemplate/loreTemplate) —
// the exact same generator the manual `node scripts/scaffold-world.mjs`
// CLI path uses for a hand-scaffolded world — rather than forking a
// second placeholder taxonomy. Those functions were previously
// unexported CLI-internal helpers; they're now exported (additive-only
// change, see that file) specifically for this reuse.
//
// Genre-flavor mapping — HONEST BY CONSTRUCTION:
// A Foundry worldspec's `theme.universeType` is one of 10 values (see
// worldspec.js's VALID_UNIVERSE_TYPES: fantasy / scifi / noir / cyber /
// post-apocalyptic / historical / surreal / slice-of-life / horror /
// mythic). scaffold-world.mjs's --template flavor tables only cover 4
// archetype names (fantasy / cyber / crime / superhero — the ones with
// real per-genre OCCUPATIONS/FACTION_NAME/FACTION_GOAL tables in
// scripts/author/generators.mjs). Rather than force a strained mapping
// for the 6 universeTypes with no real correspondent, only the
// genuinely-corresponding ones below get scaffold-world flavor;
// everything else falls back to scaffold-world's existing, well-tested
// GENERIC placeholder path (template=undefined) — which is still fully
// honest by design ("Scaffolded placeholder... — replace before
// shipping"), never a fabricated genre match.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileWorldspec } from "./compiler.js";
import {
  metaTemplate, npcTemplate, factionTemplate, loreTemplate, IMPLEMENTED_TEMPLATES,
} from "../../../scripts/scaffold-world.mjs";
import { validateNpc, validateFaction, validateLoreEvent } from "../content-seeder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/lib/foundry/ -> repo root -> content/world
const DEFAULT_WORLD_ROOT = path.resolve(__dirname, "..", "..", "..", "content", "world");

export const UNIVERSE_TYPE_TO_SCAFFOLD_TEMPLATE = Object.freeze({
  fantasy: "fantasy", // exact match
  mythic: "fantasy",  // myth-grounded fantasy is a real correspondence, not a stretch
  cyber: "cyber",     // exact match
  scifi: "cyber",     // nearest of the 4 implemented archetypes
  noir: "crime",      // noir <-> crime fiction is an established genre pairing
  // post-apocalyptic / historical / surreal / slice-of-life / horror
  // intentionally UNMAPPED — no genuinely-corresponding scaffold-world
  // archetype exists; these fall back to the generic placeholder path.
});

/** Resolve a worldspec's universeType to a scaffold-world --template name,
 *  or undefined for the generic (unflavored) placeholder path. Defensive
 *  against a future mapping typo: only ever returns a name scaffold-world
 *  actually implements. */
export function scaffoldTemplateFor(universeType) {
  const candidate = UNIVERSE_TYPE_TO_SCAFFOLD_TEMPLATE[universeType];
  return candidate && IMPLEMENTED_TEMPLATES.includes(candidate) ? candidate : undefined;
}

/**
 * Build the promoted content/world/<worldId>/ payload in memory. Never
 * touches disk — callers decide where/whether to write it (so tests can
 * target a throwaway directory instead of the real repo tree).
 *
 * @param {object} opts
 * @param {string} opts.worldId - the ALREADY-PUBLISHED `worlds` row id
 *   (e.g. "world-xxxx"). Reusing this exact id as both the directory name
 *   and meta.world_id is deliberate: content-seeder's upsertWorldRow does
 *   `INSERT ... ON CONFLICT(id) DO UPDATE`, so the next boot's seed pass
 *   updates the SAME worlds row Foundry already created instead of
 *   minting an orphan second row.
 * @param {string} opts.worldName
 * @param {object} opts.worldspec - normalized Foundry worldspec (theme,
 *   systems, ...)
 * @param {string} [opts.description]
 */
export function buildPromotedContent({ worldId, worldName, worldspec, description }) {
  const universeType = worldspec?.theme?.universeType || "fantasy";
  const template = scaffoldTemplateFor(universeType);
  const compiled = compileWorldspec(worldspec);

  const meta = metaTemplate(worldId, worldName, universeType, template);
  if (description) meta.description = description;
  // Provenance — never fabricated: this is exactly what compileWorldspec
  // really activated for this worldspec, so a reader can tell a promoted
  // Foundry world apart from a hand-authored one and see what drove it.
  meta.foundry_source = {
    promotedFrom: "foundry",
    universeType,
    scaffoldTemplate: template || null,
    activatedSystems: compiled.activatedSystems,
    skippedStubs: compiled.skippedStubs,
  };

  const npc = npcTemplate(worldId, worldName, template);
  const faction = factionTemplate(worldId, worldName, template);
  const lore = loreTemplate(worldId, worldName);

  return {
    meta,
    npcs: [npc],
    factions: [faction],
    lore,
    scaffoldTemplate: template || null,
    activatedSystems: compiled.activatedSystems,
  };
}

/**
 * Validate every generated record through the REAL, unmodified
 * content-seeder.js validators — the same functions the boot-time seed
 * pass itself calls. Returns an array of problem strings (empty = clean).
 */
export function validatePromotedContent(content) {
  const problems = [];
  if (typeof content?.meta?.world_id !== "string" || !content.meta.world_id) {
    problems.push("meta.world_id missing/empty");
  }
  if (typeof content?.meta?.universe_type !== "string" || !content.meta.universe_type) {
    problems.push("meta.universe_type missing/empty");
  }
  const npc = Array.isArray(content?.npcs) ? content.npcs[0] : null;
  const npcResult = validateNpc(npc);
  if (!npcResult.ok) problems.push(`npc failed validateNpc: ${npcResult.reason}`);

  const faction = Array.isArray(content?.factions) ? content.factions[0] : null;
  const factionResult = validateFaction(faction);
  if (!factionResult.ok) problems.push(`faction failed validateFaction: ${factionResult.reason}`);

  const loreEvent = content?.lore?.history?.[0];
  const loreResult = validateLoreEvent(loreEvent);
  if (!loreResult.ok) problems.push(`lore event failed validateLoreEvent: ${loreResult.reason}`);

  return problems;
}

/**
 * Write the promoted content to <worldRoot>/<worldId>/{meta,npcs,
 * factions,lore}.json. `worldRoot` defaults to the real repo's
 * content/world — tests MUST override it with a throwaway directory.
 * Overwrites any existing files for the same worldId (the caller —
 * foundry.promote — is responsible for the idempotent/force decision;
 * this function just writes what it's given).
 */
export function writePromotedContent(content, { worldId, worldRoot = DEFAULT_WORLD_ROOT } = {}) {
  if (!worldId) throw new Error("writePromotedContent requires worldId");
  const dir = path.join(worldRoot, worldId);
  fs.mkdirSync(dir, { recursive: true });
  const writeJson = (name, obj) => {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
  };
  writeJson("meta.json", content.meta);
  writeJson("npcs.json", content.npcs);
  writeJson("factions.json", content.factions);
  writeJson("lore.json", content.lore);
  return { dir };
}

export const PROMOTE_INTERNALS = Object.freeze({ DEFAULT_WORLD_ROOT });
