// server/tests/sql-interpolation-ratchet.test.js
//
// SQL-injection audit + ratchet for `db.prepare`/`db.exec` template literals
// that interpolate `${...}` (audited 2026-07-28).
//
// ─── THE AUDIT, AND ITS RESULT ──────────────────────────────────────────────
//
// The security dump flagged "db.prepare template interpolation (168 sites)" as
// an unwalked SAST class — the place SQL injection would actually live. Walked
// it: 204 runtime sites across 124 files (migrations/ excluded — they run at
// boot with no request data). Every one is SAFE. Values are bound with
//
// ─── A METHODOLOGY ERROR WORTH KEEPING ──────────────────────────────────────
//
// The first pass used a line-based `grep` and found "106 sites in 63 files",
// and a clean-looking audit was written up on that basis. It was wrong:
// `grep` matches per LINE, but `[^`]*` in a JS regex spans newlines, so every
// MULTI-LINE `db.prepare(`...\n...${x}...`)` template was invisible to it —
// 98 sites in 61 files, roughly half the real surface, silently unreviewed.
//
// The whole-file scanner below caught it only because it disagreed with the
// hand-built inventory and the mismatch was investigated instead of being
// treated as a broken test. If you extend this file, keep the scanner reading
// whole files; a line-oriented tool cannot see this construct at all.
//
// Values are consistently bound with
// `?`; only IDENTIFIERS (table/column names) and generated placeholder strings
// are interpolated, and each traces to a literal, a module constant, an
// allowlist, or a regex guard:
//
//   durable.js#paginatedQuery      PAGINATED_VALID_TABLES maps table -> Set of
//                                  valid columns; table, orderBy column,
//                                  orderBy DIRECTION, searchCols and every
//                                  filter KEY are all validated before use.
//   lib/training-consent.js        PLATFORM_TABLES allowlist on `table` plus
//                                  /^[a-zA-Z_][a-zA-Z0-9_]*$/ on `idCol`.
//   lib/world-snapshot.js          iterates the PER_WORLD_WRITE_TABLES constant.
//   domains/ar.js#dbStore          `table` is a parameter, but all four callers
//                                  pass string literals (ar_scenes, ...).
//   lib/combat/loadout.js          `col` is a ternary over two literals.
//   lib/npc-persona.js             table/cols come from a hardcoded `installs`
//                                  array; the user-supplied package supplies
//                                  only VALUES, which are bound with `?`.
//   lib/gear-durability.js         hasColumn() callers all pass literals.
//
// A scan for any interpolated identifier assigned from `req.` / `params.` /
// `input.` / `body.` / `query.` in the same file returned ZERO hits.
//
// So this file fixes nothing — there was nothing to fix. It exists so the
// finding does not have to be re-derived, and so the property cannot quietly
// stop being true.
//
// ─── WHY A RATCHET RATHER THAN A DETECTOR ───────────────────────────────────
//
// Deciding statically whether an interpolated identifier is attacker-reachable
// needs interprocedural taint analysis; a regex approximation would be
// false-positive noise, and a noisy gate is one people learn to ignore (see
// CLAUDE.md on the detector ratchet that cried wolf). Instead this pins the
// exact inventory: a NEW file introducing SQL interpolation, or a new site in
// an existing one, fails the test and forces a human to look at it.
//
// WHEN THIS FAILS: do not just bump the number. Open the new site and confirm
// the interpolated part is an identifier from a literal/constant/allowlist and
// that every VALUE is bound with `?`. Then update the count in the same commit
// — the same discipline this repo applies to doc-claim drift.
//
// Run: node --test server/tests/sql-interpolation-ratchet.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL_INTERP = /db\.(prepare|exec)\(`[^`]*\$\{/g;

// Reviewed inventory: file -> number of interpolating db.prepare/exec sites.
// Every entry below was individually read and found to interpolate only
// identifiers from literals, constants, allowlists or regex-guarded input.
const REVIEWED = {
  "domains/_dtu-recent-mine.js": 4,
  "domains/ar.js": 5,
  "domains/companion.js": 1,
  "domains/creatures.js": 1,
  "domains/crisis.js": 1,
  "domains/dreams.js": 1,
  "domains/dtu-surface.js": 1,
  "domains/event-timeline.js": 4,
  "domains/foundry.js": 1,
  "domains/garage.js": 2,
  "domains/goddess.js": 2,
  // domains/hermes-memory.js (2) — both interpolate a fixed literal SQL
  // fragment `"AND memory_kind = ?"` (or "") chosen by a boolean gate;
  // memory_kind itself is allowlist-checked (MEMORY_KINDS.has(...)) before
  // the gate runs and bound via `?` regardless. No user string reaches SQL text.
  "domains/hermes-memory.js": 2,
  "domains/literary.js": 2,
  "domains/profile.js": 2,
  "domains/repair.js": 1,
  "domains/sessions.js": 3,
  "domains/vault.js": 2,
  "domains/world-overview.js": 2,
  "domains/world.js": 1,
  "durable.js": 7,
  "economy/balances.js": 1,
  "economy/coin-service.js": 1,
  "economy/commission-service.js": 1,
  "economy/creative-marketplace.js": 1,
  "economy/film-studio.js": 4,
  "economy/legal-liability.js": 1,
  "economy/lens-culture.js": 3,
  "economy/purchases.js": 1,
  "economy/routes.js": 1,
  "economy/storage.js": 1,
  "economy/treasury-reconciliation.js": 1,
  "economy/withdrawals.js": 1,
  "emergent/agent-drift-watch-cycle.js": 1,
  "emergent/environment-sensor.js": 2,
  // emergent/forgetting-engine.js (1) — `placeholders` is
  // liveIds.map(() => "(?, ?, ?, ?, NULL, 0)").join(", "), a repeat-count
  // string with zero embedded data; every value is bound via the params array.
  "emergent/forgetting-engine.js": 1,
  "emergent/nemesis-cycle.js": 1,
  "guidance.js": 5,
  "lib/account-lifecycle.js": 1,
  "lib/achievement-engine.js": 1,
  "lib/activitypub-bridge.js": 1,
  "lib/agent-marathon.js": 1,
  "lib/agent-self.js": 1,
  "lib/ambient-chat.js": 1,
  "lib/announcements.js": 2,
  "lib/auctions.js": 1,
  "lib/betting-markets.js": 2,
  "lib/causal-edges.js": 1,
  "lib/city-engine.js": 1,
  "lib/collective-face.js": 1,
  "lib/combat-restraint.js": 1,
  "lib/combat/damage-calculator.js": 1,
  "lib/combat/faction-war.js": 1,
  "lib/combat/flow-recorder.js": 2,
  "lib/combat/loadout.js": 3,
  "lib/companions-mount-evo.js": 1,
  "lib/creator-dashboard.js": 1,
  "lib/cross-lens-discovery.js": 2,
  "lib/detectors/dtu-lineage-detector.js": 4,
  "lib/detectors/predictive-growth-detector.js": 1,
  // lib/dila-recall.js (1) — `kinds` = config.skipMemoryKinds.map(() =>
  // '?').join(',') — placeholder-count string only; the actual kind values
  // are spread into .all(...config.skipMemoryKinds) and bound normally.
  "lib/dila-recall.js": 1,
  // lib/dtu-operations-log.js (2) — getOperationsLog's `where` is assembled
  // only from a fixed set of hardcoded "<col> = ?" fragments gated by
  // presence checks (never user string content becomes SQL text); `limit`
  // is Math.max(1, Math.min(1000, ...)) — always a finite number or NaN,
  // never a string, so it cannot inject text even unbound. tombstone
  // OperationalDTUs' `placeholders` is the same fixed-count IN-clause
  // idiom as forgetting-engine.js above, over a module constant array.
  "lib/dtu-operations-log.js": 2,
  "lib/dtu-portability.js": 1,
  "lib/dtu-protection.js": 4,
  "lib/dx/severity-evo.js": 1,
  "lib/ecosystem/score-engine.js": 1,
  "lib/federation-mesh.js": 1,
  "lib/friend-presence.js": 1,
  "lib/game-theory/market-equilibrium.js": 1,
  "lib/gear-durability.js": 2,
  "lib/glyph-spells.js": 1,
  "lib/goal-decomposition.js": 1,
  "lib/hooks.js": 2,
  "lib/horror.js": 1,
  "lib/inference/context-assembler.js": 1,
  "lib/inference/thread-manager.js": 2,
  "lib/lattice-fork.js": 1,
  "lib/lattice-quest-composer.js": 1,
  "lib/lfg.js": 1,
  "lib/literary-vec.js": 1,
  "lib/long-horizon-planner.js": 1,
  "lib/macro-billing.js": 1,
  // lib/mcp-tools.js (1) — dhtpCompress's `placeholders` is the same
  // fixed-count IN-clause idiom, over boundRefs (dtuRefs capped at 33);
  // values bound via .all(...boundRefs).
  "lib/mcp-tools.js": 1,
  "lib/mentorship.js": 2,
  "lib/mount-gear.js": 2,
  "lib/news-story-composer.js": 1,
  "lib/notebook.js": 1,
  "lib/npc-building-affinity.js": 1,
  "lib/npc-dossier.js": 1,
  "lib/npc-labor-world.js": 1,
  "lib/npc-legacy.js": 1,
  "lib/npc-persona.js": 1,
  "lib/npc-stress.js": 1,
  "lib/personal-stake.js": 2,
  "lib/player-mail.js": 1,
  "lib/player-titles.js": 1,
  "lib/project-thread.js": 1,
  "lib/pvp-loot.js": 2,
  "lib/quest-archetype-bias.js": 1,
  "lib/realm-access.js": 1,
  "lib/robotics-persistence.js": 1,
  "lib/scheme-overhear.js": 1,
  "lib/secrets.js": 2,
  "lib/security-ingest.js": 1,
  "lib/settlements.js": 1,
  "lib/skill-marketplace.js": 1,
  "lib/skill-tree-engine.js": 1,
  "lib/skills/character-level.js": 1,
  "lib/social/reputation.js": 2,
  "lib/substrate-diffusion.js": 1,
  "lib/temperament-spread.js": 2,
  "lib/tools/sandbox-manager.js": 1,
  "lib/training-consent.js": 3,
  "lib/transparency.js": 1,
  "lib/trivia.js": 1,
  "lib/understanding-consumers.js": 1,
  "lib/understanding-evolve.js": 3,
  "lib/vassalage.js": 1,
  "lib/verified-human.js": 1,
  "lib/world-snapshot.js": 3,
  "lib/world-tenancy.js": 2,
  "lib/world-vehicles.js": 2,
  "routes/evo-asset.js": 3,
  "routes/inference-debug.js": 1,
  "routes/messaging.js": 2,
  "routes/player-trade.js": 5,
  "routes/training-match.js": 1,
  "routes/wagers.js": 6,
  "routes/worlds.js": 1,
  "server.js": 5,
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "tests" || e === "migrations" || e === ".git") continue;
    const p = path.join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith(".js")) out.push(p);
  }
  return out;
}

function scan() {
  const found = {};
  for (const p of walk(ROOT)) {
    const n = (readFileSync(p, "utf8").match(SQL_INTERP) || []).length;
    if (n > 0) found[path.relative(ROOT, p)] = n;
  }
  return found;
}

describe("SQL interpolation — reviewed inventory must not grow silently", () => {
  const found = scan();

  it("no NEW file has started interpolating into db.prepare/db.exec", () => {
    const added = Object.keys(found).filter((f) => !(f in REVIEWED)).sort();
    assert.deepEqual(added, [],
      `New SQL-interpolating file(s). Read each site: the interpolated part must be an ` +
      `IDENTIFIER from a literal/constant/allowlist, and every VALUE must be bound with '?'. ` +
      `Then add it to REVIEWED in the same commit.\n  ${added.join("\n  ")}`);
  });

  it("no reviewed file has GAINED interpolation sites", () => {
    const grown = Object.keys(REVIEWED)
      .filter((f) => (found[f] ?? 0) > REVIEWED[f])
      .map((f) => `${f}: ${REVIEWED[f]} -> ${found[f]}`);
    assert.deepEqual(grown, [],
      `Existing file(s) gained SQL interpolation sites — review the new ones, then update ` +
      `the count:\n  ${grown.join("\n  ")}`);
  });

  it("reports files that dropped sites, so the inventory can shrink honestly", () => {
    // Not a failure — but surfaced so REVIEWED trends down as code is
    // parameterized, instead of drifting permanently stale upward.
    const shrunk = Object.keys(REVIEWED)
      .filter((f) => (found[f] ?? 0) < REVIEWED[f])
      .map((f) => `${f}: ${REVIEWED[f]} -> ${found[f] ?? 0}`);
    if (shrunk.length) console.log(`  [info] inventory can shrink:\n    ${shrunk.join("\n    ")}`);
    assert.ok(true);
  });
});

describe("the guards that make the risky sites safe must stay", () => {
  const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

  it("durable.js validates table, orderBy, searchCols AND filter keys", () => {
    const s = read("durable.js");
    assert.match(s, /const validCols = PAGINATED_VALID_TABLES\[table\];/);
    assert.match(s, /invalid filter key/, "filter KEYS are interpolated — they must be allowlisted");
    assert.match(s, /PAGINATED_VALID_ORDER_DIRS/, "orderBy direction is interpolated too");
    assert.match(s, /_validatePaginatedParams\(table, \{ orderBy, searchCols, filters \}\);/,
      "validation must actually be CALLED, not merely defined");
  });

  it("training-consent.js allowlists the table and regex-guards the id column", () => {
    const s = read("lib/training-consent.js");
    assert.match(s, /if \(!PLATFORM_TABLES\.includes\(table\)\)/);
    assert.match(s, /\/\^\[a-zA-Z_\]\[a-zA-Z0-9_\]\*\$\/\.test\(idCol\)/);
  });

  it("world-snapshot.js iterates a constant, never a caller-supplied table", () => {
    assert.match(read("lib/world-snapshot.js"), /for \(const t of PER_WORLD_WRITE_TABLES\)/);
  });

  it("ar.js#dbStore is only ever called with literal table names", () => {
    const s = read("domains/ar.js");
    // Exclude the declaration `function dbStore(ctx, table, memMap)` — the first
    // version of this assertion matched it and reported the parameter name
    // `table` as a non-literal caller.
    const calls = [...s.matchAll(/(?<!function )dbStore\(ctx,\s*([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(calls.length >= 4, "expected the four ar_* stores");
    for (const c of calls) {
      assert.match(c, /^"ar_[a-z_]+"$/, `dbStore called with non-literal table: ${c}`);
    }
  });
});
