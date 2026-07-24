#!/usr/bin/env node
// scripts/scaffold-world.mjs
//
// World scaffolder — generates the 4-file skeleton a new
// content/world/<world-id>/ directory needs (meta.json / npcs.json /
// factions.json / lore.json).
//
// A grounding audit this session found "template worlds" is a genuine but
// NARROW gap: `server/lib/content-seeder.js#discoverSubWorlds()` already
// auto-discovers any `content/world/<name>/` directory and seeds it
// idempotently the moment it exists (a real, generic template CONSUMER —
// see seedContent()'s "for (const sub of discoverSubWorlds())" loop). What
// was missing was a template PRODUCER: nothing generated the initial
// 4-file skeleton by hand, and one field silently no-ops if wrong — see
// the "double-gate" note below.
//
// The double-gate this script exists to catch loudly:
//   `content-seeder.js#seedContent()` only calls `upsertWorldRow(db, meta)`
//   `if (meta?.world_id)` (outer gate, seedContent's sub-world loop) — but
//   `upsertWorldRow` ITSELF silently `return`s early
//   `if (!meta?.world_id || !meta?.universe_type)` (inner gate). A meta.json
//   with a `world_id` but a missing/empty `universe_type` passes the outer
//   gate, gets `registerWorldMeta()`'d into the in-memory registry, but
//   NEVER lands a `worlds` table row — no loud error, no log line, just a
//   world that silently never gets a DB row until someone notices
//   `rule_modulators`/`physics_modulators` reads coming back empty. This
//   script asserts both fields loudly at GENERATION time instead.
//
// Style/safety pattern copied from scripts/scaffold-lens.mjs (read that
// file's header first if you haven't): validate inputs against real
// enums/shapes, refuse-to-overwrite without --force, --root/--dry-run for
// test isolation, print manual-steps for anything requiring a human
// judgment call instead of guessing.
//
// This script deliberately does NOT touch:
//   - Any hardcoded per-lens WORLD_OPTIONS/WORLDS array in frontend pages
//     (e.g. concord-frontend/app/lenses/ledger/page.tsx's WORLD_OPTIONS) or
//     server/domains/spectate.js's AUTHORED_WORLDS array — whether a new
//     world belongs in a curated dropdown is a human editorial call (should
//     a half-authored placeholder world show up in a reader-facing picker
//     before it has real content?), not something a scaffolder should
//     silently decide by inserting itself into every curated list it can
//     find.
//   - server/lib/world-seeder.js's RESOURCE_TABLES. A universe_type with no
//     matching table key falls back to 'standard' automatically (see
//     `_rk()` in that file) — a real, working default, not a broken path.
//     Authoring a bespoke resource table for the new world is an optional
//     enhancement a human can do later, not a blocker to scaffolding.
//
// Usage:
//   node scripts/scaffold-world.mjs <world-id> "<World Name>" <universe_type> [options]
//
//   <world-id>       kebab-case, e.g. "verdant-reach" (must match ^[a-z][a-z0-9-]*$)
//   <World Name>     human label, e.g. "Verdant Reach"
//   <universe_type>  snake_case-ish identifier read by cross-world-effectiveness.js /
//                     world-seeder.js's RESOURCE_TABLES lookup (must match
//                     ^[a-z][a-z0-9_]*$ — real examples on disk: "sere",
//                     "crime", "lattice_crucible", "sovereign_ruins",
//                     "frontier". Not a closed enum — an unrecognized value
//                     is honest and safe, see the RESOURCE_TABLES note
//                     above — but it must be present and syntactically sane;
//                     that's what CLAUDE.md's rule means by "why", not "which".
//
// Options:
//   --root <path>   Repo root to operate against. Defaults to the real repo
//                    (one directory up from this script). Tests MUST pass a
//                    temp directory here so the real repo's content/world/
//                    directory is never touched by a test run.
//   --dry-run        Print what would be written; touch nothing.
//   --force           Overwrite existing meta.json/npcs.json/factions.json/
//                     lore.json for the same world-id. Default: refuse.
//   --template <archetype>
//                     Optional genre flavor for the generated placeholders.
//                     Uses the SAME archetype names as
//                     server/lib/world-kit-templates.js (fantasy, cyber,
//                     superhero, crime, sovereign-ruins, lattice-crucible,
//                     concord-link-frontier) rather than inventing a new
//                     naming scheme. Of those 7, this scaffolder implements
//                     genre-flavored generation for 4 today — fantasy,
//                     cyber, crime, superhero — the ones with the richest
//                     existing per-genre tables in scripts/author/
//                     generators.mjs (OCCUPATIONS / FACTION_NAME /
//                     FACTION_GOAL, exported from that file specifically so
//                     this script can reuse them instead of duplicating a
//                     4th taxonomy). Passing one of the other 3 recognized-
//                     but-not-yet-implemented names errors out explicitly
//                     rather than silently falling back to the generic
//                     placeholder. Omitting --template entirely reproduces
//                     today's exact generic-placeholder output byte-for-
//                     byte (see server/tests/scaffold-world.test.js's
//                     no-flag regression case) — the flag is strictly
//                     additive.
//
// Self-check (the load-bearing addition, per the task): before writing
// anything, this script dynamically imports the REAL, unmodified
// `validateNpc` / `validateFaction` / `validateLoreEvent` from
// server/lib/content-seeder.js — always from THIS repo's real path
// (content-seeder.js's validators are pure functions with no DB/STATE
// dependency; the --root flag only controls where scaffolded content is
// WRITTEN, never which validator logic is trusted) — and runs them against
// the generated stub records. A validator failure aborts before any file
// is written, loudly, with the validator's own `reason` string. It also
// asserts world_id/universe_type are both present and non-empty strings,
// which is the "fail loudly at generation time, not silently at boot time"
// half of the double-gate note above.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The per-genre data tables this scaffolder reuses for --template — see
// the "Options" header comment above for why these specific 3 tables
// (not world-kit-templates.js's calendar/industries/bestiary tables,
// which are one layer down at the world-KIT enrichment stage, not the
// meta/npc/faction stage this script produces).
import { OCCUPATIONS, FACTION_NAME, FACTION_GOAL } from "./author/generators.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

// Every archetype name server/lib/world-kit-templates.js recognizes — kept
// in sync with that file's PHASES_BY_GENRE/INDUSTRIES_BY_GENRE/etc. keys so
// a --template value is validated against the SAME vocabulary, not a 4th
// taxonomy. Of these, IMPLEMENTED_TEMPLATES is the subset this scaffolder
// actually draws genre flavor for today (the 4 with the richest existing
// tables in scripts/author/generators.mjs: OCCUPATIONS / FACTION_NAME /
// FACTION_GOAL all key on exactly these 4 archetype names).
const KNOWN_TEMPLATES = Object.freeze([
  "fantasy", "cyber", "superhero", "crime",
  "sovereign-ruins", "lattice-crucible", "concord-link-frontier",
]);
const IMPLEMENTED_TEMPLATES = Object.freeze(["fantasy", "cyber", "crime", "superhero"]);

// tech_level / magic_level per implemented archetype. These values MIRROR
// the real, already-authored content/world/<archetype>/meta.json files for
// the same archetype names (verified against the working tree) — they are
// reused/cited, not invented, so a scaffolded fantasy/cyber/crime/superhero
// world starts consistent with the existing canon worlds of that same
// genre instead of a fabricated tech/magic guess. If the canon worlds'
// values ever drift, update here to match — this table is a snapshot
// citation, not an independent source of truth.
const TECH_MAGIC_BY_TEMPLATE = Object.freeze({
  fantasy: { tech_level: "pre-industrial", magic_level: "abundant" },
  cyber: { tech_level: "near_future", magic_level: "trace" },
  crime: { tech_level: "modern", magic_level: "none" },
  superhero: { tech_level: "modern_high_tech", magic_level: "none" },
});

// content-seeder.js's validators are read from the REAL repo location
// regardless of --root — see the header comment above for why this is
// safe and intentional (pure functions, read-only import, no side effects
// — verified: importing content-seeder.js standalone with no DB/server
// boot succeeds cleanly).
const REAL_CONTENT_SEEDER = path.join(DEFAULT_ROOT, "server/lib/content-seeder.js");

const WORLD_ID_RE = /^[a-z][a-z0-9-]*$/;
const UNIVERSE_TYPE_RE = /^[a-z][a-z0-9_]*$/;

// ── CLI parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = { root: DEFAULT_ROOT, dryRun: false, force: false, template: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { opts.root = path.resolve(argv[++i] || ""); }
    else if (a === "--dry-run") { opts.dryRun = true; }
    else if (a === "--force") { opts.force = true; }
    else if (a === "--template") { opts.template = argv[++i]; }
    else if (a.startsWith("--")) { throw new Error(`unknown option: ${a}`); }
    else positional.push(a);
  }
  const [worldId, worldName, universeType] = positional;
  return { worldId, worldName, universeType, ...opts };
}

function usage() {
  return [
    'usage: node scripts/scaffold-world.mjs <world-id> "<World Name>" <universe_type> [--root <path>] [--dry-run] [--force] [--template <archetype>]',
    "",
    "  <world-id>       kebab-case, e.g. \"verdant-reach\" — must match " + WORLD_ID_RE,
    "  <universe_type>  e.g. \"verdant_reach\" — must match " + UNIVERSE_TYPE_RE + " (not a closed enum — see the file header)",
    "  --template       optional genre flavor; implemented: " + IMPLEMENTED_TEMPLATES.join(", ") +
      " (recognized but not yet implemented: " + KNOWN_TEMPLATES.filter(t => !IMPLEMENTED_TEMPLATES.includes(t)).join(", ") + ")",
  ].join("\n");
}

// ── Validation ───────────────────────────────────────────────────────────

function validate({ worldId, worldName, universeType, template }) {
  const errors = [];
  if (!worldId || !WORLD_ID_RE.test(worldId)) {
    errors.push(`world-id "${worldId}" must be kebab-case matching ${WORLD_ID_RE}`);
  }
  if (!worldName || !worldName.trim()) {
    errors.push('world name is required (pass it quoted, e.g. "Verdant Reach")');
  }
  if (!universeType || !UNIVERSE_TYPE_RE.test(universeType)) {
    errors.push(`universe_type "${universeType}" must match ${UNIVERSE_TYPE_RE} (lowercase, starts with a letter, underscores allowed)`);
  }
  if (template !== undefined) {
    if (!KNOWN_TEMPLATES.includes(template)) {
      errors.push(`--template "${template}" is not a recognized archetype name — known: ${KNOWN_TEMPLATES.join(", ")} (see server/lib/world-kit-templates.js)`);
    } else if (!IMPLEMENTED_TEMPLATES.includes(template)) {
      errors.push(`--template "${template}" is a recognized archetype name but this scaffolder does not yet implement genre-flavored generation for it — implemented: ${IMPLEMENTED_TEMPLATES.join(", ")}. Omit --template for the generic placeholder instead.`);
    }
  }
  return errors;
}

// ── Content templates ────────────────────────────────────────────────────
//
// Every generated record is an honest, minimal placeholder — never a
// fabricated "looks real" value. Per CLAUDE.md's "honest by construction"
// invariant, placeholder prose says it's a placeholder rather than
// pretending to be authored lore.

// `template` is undefined for the default (no --template) path in every
// function below, and every default branch below is byte-for-byte the
// original pre-template text/shape — see the no-flag regression test.

function metaTemplate(worldId, worldName, universeType, template) {
  const flavor = template ? TECH_MAGIC_BY_TEMPLATE[template] : null;
  return {
    world_id: worldId,
    world_name: worldName,
    universe_type: universeType,
    is_hub: false,
    // Free-form strings read by upsertWorldRow's rule_modulators fold and
    // by downstream affinity/potency lookups — "unspecified" is an honest
    // placeholder, not a fabricated setting, when no --template is given.
    // With --template, these come from TECH_MAGIC_BY_TEMPLATE (see above)
    // instead of a generic guess.
    tech_level: flavor ? flavor.tech_level : "unspecified",
    magic_level: flavor ? flavor.magic_level : "unspecified",
    description: flavor
      ? `Scaffolded placeholder for the "${worldName}" world (template: ${template}) — generated by scripts/scaffold-world.mjs. tech_level/magic_level above were seeded from the "${template}" archetype's existing per-genre data (see TECH_MAGIC_BY_TEMPLATE); replace this description and everything else with real authored content before treating this world as shipped.`
      : `Scaffolded placeholder for the "${worldName}" world — generated by scripts/scaffold-world.mjs. Replace this description (and tech_level/magic_level above) with real authored content before treating this world as shipped.`,
    skill_affinity: { default: 0.7 },
    rule_modulators: {},
  };
}

function npcTemplate(worldId, worldName, template) {
  // OCCUPATIONS[template][0] is a deterministic pick (always the table's
  // first entry) — no rng — so the same --template always produces the
  // same flavored occupation, keeping the scaffolder's output reproducible.
  const occupation = template ? OCCUPATIONS[template][0] : null;
  return {
    id: `${worldId}_first_resident`,
    name: "Unnamed Resident",
    faction_id: `${worldId}_founding_circle`,
    world_id: worldId,
    archetype: occupation || "villager",
    personality: occupation
      ? `Scaffolded placeholder resident of ${worldName} (template: ${template}) — a ${occupation} by trade. Replace with a real authored personality before shipping this world.`
      : `Scaffolded placeholder resident of ${worldName} — replace with a real authored personality before shipping this world.`,
    background: occupation
      ? `No background has been authored yet. This record exists only to satisfy validateNpc() so the world seeds cleanly; it is not real content. (Occupation flavor drawn from scripts/author/generators.mjs's OCCUPATIONS["${template}"] table.)`
      : "No background has been authored yet. This record exists only to satisfy validateNpc() so the world seeds cleanly; it is not real content.",
    narrative_context: {},
  };
}

function factionTemplate(worldId, worldName, template) {
  // FACTION_NAME[template].a[0] / .b[0] are the same deterministic
  // first-entry pick pattern as npcTemplate's occupation above.
  const name = template
    ? `${FACTION_NAME[template].a[0]} ${FACTION_NAME[template].b[0]}`.replace(/-\s/, "-")
    : "The Founding Circle";
  const goalFlavor = template ? FACTION_GOAL[template][0] : null;
  return {
    id: `${worldId}_founding_circle`,
    name,
    world_id: worldId,
    goal: goalFlavor
      ? `Scaffolded placeholder faction for ${worldName} (template: ${template}) — genre-flavored starting goal drawn from scripts/author/generators.mjs's FACTION_GOAL["${template}"] table: "${goalFlavor}". Replace with a real authored goal, values, and rivalries before shipping this world.`
      : `Scaffolded placeholder faction for ${worldName} — replace with a real authored goal, values, and rivalries before shipping this world.`,
    // Exercises validateFaction()'s hex-color visual branch with valid
    // 6-digit hex values (neutral gray placeholders, not a real palette).
    visual: {
      primary_color: "#4a4a4a",
      secondary_color: "#1a1a1a",
      accent_color: "#8a8a8a",
    },
  };
}

function loreTemplate(worldId, worldName) {
  return {
    history: [
      {
        id: `lore_${worldId}_founding`,
        title: `The Founding of ${worldName}`,
        type: "founding_event",
        era: "unspecified",
        description: `Scaffolded placeholder lore event for ${worldName} — replace with a real authored founding event before shipping this world.`,
        significance: "minor",
      },
    ],
  };
}

// ── Self-check ───────────────────────────────────────────────────────────

async function selfCheck(content, { worldId, worldName }) {
  const problems = [];

  // The double-gate assertion — fail loudly here, not silently at boot.
  if (typeof content.meta.world_id !== "string" || !content.meta.world_id) {
    problems.push("meta.world_id is missing/empty — content-seeder's discoverSubWorlds loop will never call upsertWorldRow for this world");
  }
  if (typeof content.meta.universe_type !== "string" || !content.meta.universe_type) {
    problems.push("meta.universe_type is missing/empty — upsertWorldRow's inner gate (`if (!meta?.world_id || !meta?.universe_type) return;`) will silently no-op even though world_id passed the outer gate; the world will register in-memory (registerWorldMeta) but NEVER get a `worlds` table row");
  }

  let validators;
  try {
    const mod = await import(pathToFileURL(REAL_CONTENT_SEEDER).href);
    validators = {
      validateNpc: mod.validateNpc,
      validateFaction: mod.validateFaction,
      validateLoreEvent: mod.validateLoreEvent,
    };
  } catch (err) {
    problems.push(`could not import the real validators from ${REAL_CONTENT_SEEDER}: ${err.message}`);
    return problems;
  }

  for (const [name, fn] of Object.entries(validators)) {
    if (typeof fn !== "function") problems.push(`content-seeder.js no longer exports ${name}() — self-check cannot run`);
  }
  if (problems.length > 0) return problems;

  const npcResult = validators.validateNpc(content.npcs[0]);
  if (!npcResult.ok) problems.push(`generated NPC failed the real validateNpc(): ${npcResult.reason}`);

  const factionResult = validators.validateFaction(content.factions[0]);
  if (!factionResult.ok) problems.push(`generated faction failed the real validateFaction(): ${factionResult.reason}`);

  const loreResult = validators.validateLoreEvent(content.lore.history[0]);
  if (!loreResult.ok) problems.push(`generated lore event failed the real validateLoreEvent(): ${loreResult.reason}`);

  return problems;
}

// ── Safe file writers ────────────────────────────────────────────────────

function writeJsonChecked(filePath, obj, { dryRun, force }) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  // Real round-trip check, not a string-contains assertion — proves the
  // generated file is syntactically valid JSON before it ever touches disk.
  const reparsed = JSON.parse(text);
  if (JSON.stringify(reparsed) !== JSON.stringify(obj)) {
    throw new Error(`internal error: JSON round-trip mismatch for ${filePath}`);
  }
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`refusing to overwrite existing file (pass --force to override): ${filePath}`);
  }
  if (dryRun) {
    console.log(`[dry-run] would write ${filePath}:\n${"-".repeat(72)}\n${text}${"-".repeat(72)}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
  console.log(`wrote ${filePath}`);
}

function printManualSteps(worldId) {
  console.log(`
── Manual steps this script intentionally does NOT automate ──────────────

1. Decide whether "${worldId}" should appear in curated world dropdowns —
   this script does NOT edit either of these (human editorial call: should
   a freshly-scaffolded, still-placeholder world show up in a reader-facing
   picker before it has real content?):
     - server/domains/spectate.js's AUTHORED_WORLDS array
     - any per-lens hardcoded WORLD_OPTIONS/WORLDS array in a frontend page
       (e.g. concord-frontend/app/lenses/ledger/page.tsx's WORLD_OPTIONS)

2. (Optional, not a blocker) Author a bespoke resource table for
   "${worldId}" in server/lib/world-seeder.js's RESOURCE_TABLES if the
   default 'standard' fallback (see that file's _rk()) doesn't fit the
   world's theme.

3. Replace every "Scaffolded placeholder" string in the 4 generated files
   with real authored content before treating this world as shipped —
   per CLAUDE.md's "honest by construction" / "zero demo content"
   invariants, placeholder text must never be mistaken for real lore.

4. Boot the server (or run the content-seeder's own tests) once to confirm
   discoverSubWorlds() picks the new directory up and seedContent() logs a
   non-zero count for it — this script's self-check proves the records are
   individually valid, not that a live seed pass actually ran.

Next: run node scripts/scaffold-world-kit.js ${worldId}
`);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }

  const errors = validate(args);
  if (errors.length > 0) {
    console.error("scaffold-world: invalid arguments:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  const { worldId, worldName, universeType, root, dryRun, force, template } = args;
  const worldDir = path.join(root, "content/world", worldId);
  const metaFile = path.join(worldDir, "meta.json");
  const npcsFile = path.join(worldDir, "npcs.json");
  const factionsFile = path.join(worldDir, "factions.json");
  const loreFile = path.join(worldDir, "lore.json");

  // Appending nothing when --template is omitted keeps this log line
  // byte-for-byte identical to the pre-template output (see the no-flag
  // regression test).
  const templateLogSuffix = template ? ` template=${template}` : "";
  console.log(`scaffold-world: root=${root} worldId=${worldId} universeType=${universeType}${templateLogSuffix} dryRun=${dryRun}`);

  const content = {
    meta: metaTemplate(worldId, worldName, universeType, template),
    npcs: [npcTemplate(worldId, worldName, template)],
    factions: [factionTemplate(worldId, worldName, template)],
    lore: loreTemplate(worldId, worldName),
  };

  const problems = await selfCheck(content, { worldId, worldName });
  if (problems.length > 0) {
    console.error("scaffold-world: self-check FAILED before writing anything:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("self-check: generated meta/npc/faction/lore records pass the real content-seeder.js validators — OK");

  try {
    writeJsonChecked(metaFile, content.meta, { dryRun, force });
    writeJsonChecked(npcsFile, content.npcs, { dryRun, force });
    writeJsonChecked(factionsFile, content.factions, { dryRun, force });
    writeJsonChecked(loreFile, content.lore, { dryRun, force });
  } catch (err) {
    console.error(`scaffold-world: ${err.message}`);
    process.exit(1);
  }

  if (!dryRun) printManualSteps(worldId);
}

main();
