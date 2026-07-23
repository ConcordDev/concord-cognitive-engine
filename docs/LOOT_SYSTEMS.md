# Loot & Drop Systems — Catalog + Yield-Roll Addition

**Date:** 2026-07-23 · Scope: the three loot/drop systems in the Concordia gameplay stack
(NPC-death loot, PvP-death loot + robbery, creature-butcher loot), the new resource-node gather
yield-roll, and the "does one death event fire two currency mechanics?" (Gap 3) verdict. All claims
below were verified by reading the actual source at the paths cited, not by trusting any prior audit
doc. No behavior in the three catalogued systems was changed; the only code change is the gather
yield-roll (§4).

---

## 1. Summary verdict

There are **three independent loot systems**, each with a distinct trigger, a distinct data model,
and a distinct currency. They do not overlap and they are not duplicates — each covers a different
death/harvest event:

| System | File | Trigger | Currency | Model |
|---|---|---|---|---|
| **NPC-death loot** | `server/lib/loot-generator.js` | a player kills a world NPC | items only (no currency) | activity-seeded loot table → `loot_bags` |
| **PvP-death loot + robbery** | `server/lib/pvp-loot.js` | a player/NPC kills a player, or a crime-world robbery | **sparks** (+ items) | `death_loot_bags` / `loot_bags` + `sparks_ledger` |
| **Creature-butcher loot** | `server/lib/ecosystem/loot-tables.js` | a player harvests a creature corpse | items only (no currency) | per-species drop table, rolled per-drop |

A **fourth** death mechanic — the Dark-Souls shadow-corpse (`server/lib/player-corpse.js`) — is not a
loot *table* but a self-recoverable **Concord Coin** penalty; it is catalogued in §5 because it is the
other half of the Gap-3 currency-separation question.

**Yield addition (this pass):** resource-node gathering (`server/lib/world-gathering.js`) previously
returned a flat deterministic amount per gather; it now rolls a symmetric ±25% variance (expected
value = the old formula, so balance is preserved) plus a quality/skill-scaled "rich strike" rarity
bonus (§4). Depletion, respawn, and conservation are untouched.

**Gap-3 verdict:** **NO double-fire, no bug.** Each wired death event fires exactly one mechanic on
exactly one currency; the two death currencies (`concordia_credits` vs `sparks`) are separate by
design (§6).

---

## 2. NPC-death loot — `server/lib/loot-generator.js`

**Trigger / call site:** `routes/worlds.js:1003-1005` — when a player kills a world NPC, the route
imports `generateNPCLoot(npc, gear)` + `createLootBag(...)` and drops a bag at the NPC's last
position (`owner_type='npc'`, `killer_type='player'`).

**Model:** loot is seeded from *what the NPC was doing at death*. `ACTIVITY_LOOT`
(`loot-generator.js:18`) keys drop pools by activity (`gathering`/`crafting`/`patrolling`/`trading`/
`resting`/`idle`); `ARCHETYPE_BONUS` (`:57`) adds archetype-specific extras (blacksmith → iron
ingot, alchemist → potion vial, etc.). `generateNPCLoot` (`:83`) weights + samples the pools, capped
at `MAX_LOOT_SLOTS = 8`. Bags live in `loot_bags` (migration 061) with `LOOT_BAG_TTL_MS = 5 min`.

**No currency.** This system drops *items only* — it never touches `sparks` or `concordia_credits`.

**Exports:** `generateNPCLoot` (`:83`), `generatePlayerLoot` (`:148`), `createLootBag` (`:189`),
`claimLootBag` (`:216`), `reclaimExpiredBags` (`:234`). Note `generatePlayerLoot` is a **currently
un-wired export** — grep across `server/` finds no call site; the player-death item drop that *is*
wired flows through `pvp-loot.js` (§3), not this function.

---

## 3. PvP-death loot + robbery — `server/lib/pvp-loot.js`

Header rules (`pvp-loot.js:6-11`): DTUs / personal locker never touched; **CC never transferred
non-consensually**; sparks up to 30% on death / 20% on robbery; 1–3 items on death, 1 on robbery;
only in `crime_world` or `combat` game modes (`ALLOWED_MODES`, `:25`).

- **`handlePlayerDeath`** (`:37`) — call site `routes/world.js:2283` (`POST /api/world/combat/death`).
  Debits `DEATH_SPARKS_PCT = 0.30` of the victim's `sparks` (`:20`), removes 1–3 random inventory
  items, creates a `death_loot_bags` row. The sparks debit + `sparks_ledger` insert are one
  transaction (`:57-64`). **Note:** grep of `concord-frontend/` for `combat/death` = 0 hits — this
  route has no wired client caller today; the live player-kill path is the socket one in §5/§6.
- **`claimLootBag`** (`:88`) — killer-priority window `KILLER_PRIORITY_MS = 2 min`, then open; credits
  sparks + transfers items to the claimer, transactionally (`:105-112`).
- **`handleRobbery`** (`:145`) — crime-world only; steals `ROBBERY_SPARKS_PCT = 0.20` of victim sparks
  + 1 random item; victim-debit / robber-credit / two ledger rows all in one transaction (`:165-175`).
- **`handleNPCKilledPlayer`** (`:206`) — call site `routes/worlds.js:3276` (NPC-attack kill route).
  Same 30% sparks drop + 1–3 items; bags into `loot_bags`; the killer NPC immediately claims (sparks
  → `world_npcs.wealth_sparks`, items → `activity_resources`). That route **never** calls
  `dropCorpseOnDeath` (§6).
- **`reclaimExpiredBags`** (`:285`) — returns unclaimed expired bag contents to the original owner.

**Currency: `sparks` only** (migration 048; zero real-world value, own `sparks_ledger`; used by
betting/wages/bail/guild banks). This system never touches `concordia_credits`.

---

## 4. Creature-butcher loot — `server/lib/ecosystem/loot-tables.js`

**Trigger / call site:** `routes/world-creature.js:143` — the butcher endpoint rolls
`rollLoot(corpse.species_id, qualityMultiplier)` when a player harvests a creature corpse.

**Model:** `LOOT` (`loot-tables.js:23`) is a frozen per-species table; each entry is
`{ item, qtyRange:[min,max], rarity, chance }` rolled *independently per drop* (`rollLoot`, `:199`),
so one corpse can yield several items. `qualityMultiplier` scales quantity; `rarity` folds into the
inventory row's `quality`. Equippable drops roll affixes (`rollAffixes`) + set membership
(`setIdForAffixes`). Hybrids with no table entry fall back to `composeDrops` from the blueprint
(`world-creature.js:144-146`, `procedural-meat-composer.js`).

**No currency.** Items only.

**Exports:** `rollLoot` (`:199`), `speciesForBiome` (`:324`), `lifestyleForSpecies` (`:350`),
`LOOT_TABLES` (`:357`).

---

## 5. Resource-node gather yield roll — `server/lib/world-gathering.js` (changed this pass)

Resource-node gathering (mine/chop/harvest a `world_resource_nodes` node) is a *harvest*, not a
death-loot event, but it shares the "how much do I get" question. Previously `gatherFromNode` fed the
flat deterministic `estimateYield` amount straight into the atomic decrement. Now:

- **New export `rollYield(baseAmount, { nodeQuality, skillLevel, rng })`** (`world-gathering.js`,
  yield-calculation section, style-matched to `_rolledQuality`): applies a symmetric variance
  multiplier `0.75 + rng()·0.5` (EV = 1.0, so the long-run mean equals the old formula) then a
  **rich-strike** rarity bonus — base chance by node quality (`common .05 / uncommon .10 / rare .15 /
  legendary .25`) + up to `+0.10` from `skillLevel/1000`; on a hit, `+ max(1, round(base·0.5))` bonus
  units. Stateless; two `rng()` draws (variance, then strike) in a stable order so an injected
  deterministic rng makes the result exactly predictable. Returns `{ amount, richStrike }`.
- **`gatherFromNode`** now accepts `opts.rng` (default `Math.random`, test-injectable): it computes the
  `estimateYield` baseline, passes it through `rollYield`, and feeds the rolled amount into the
  **existing** atomic TOCTOU-safe decrement UPDATE. Depletion / respawn bookkeeping is untouched, and
  `extracted = min(amount, quantity_remaining)` still bounds the take at remaining stock — so
  **conservation is preserved** (draining a 20-stock node still extracts exactly 20). On a rich strike
  the primary gathered item carries an honest `richStrike: true` flag. The secondary-drop lines
  (coal→flint 25%, deep-ore→gem 10%, tree→branches) are unchanged.
- **`npcGatherFromNode`** takes an optional trailing `opts = { rng }` and applies the *same* baseline
  formula + `rollYield`, so NPC harvest yield has parity with the player path. Its return shape is
  unchanged (additive — pinned by `world-gathering-npc-node-fields.test.js`).

**Honest residual:** the player-only secondary bonus drops (flint / gem-fragment / branches) stay
player-only. The NPC caller (`npc-simulator.js`, off-limits this pass) consumes a single-resource
return shape, so adding unconsumed bonus fields to `npcGatherFromNode` would be scaffold, not a
feature — deliberately not done.

**Tests:** `server/tests/world-gathering-yield-roll.test.js` (bounds, EV preservation, rich-strike
on/off, exact-prediction through `gatherFromNode`, conservation regression, NPC parity).

---

## 6. Gap 3 — does one death event fire two currency mechanics? **No.**

The concern: a player death might drop *both* a Concord-Coin shadow-corpse (`player-corpse.js`) *and*
a sparks loot bag (`pvp-loot.js`), double-penalizing on one death. Evidence says it does not — each
wired death event fires exactly one mechanic:

| Wired death event | Call site | Mechanic | Currency |
|---|---|---|---|
| Socket PvP `combat:attack` kill (player target, not training) | `server.js:9737` + macro `domains/player-corpse.js:24` | `dropCorpseOnDeath` → shadow corpse | **`concordia_credits`** (25% of wallet, capped 1000) |
| NPC-attack kill route | `routes/worlds.js:3276` | `handleNPCKilledPlayer` → sparks loot bag | **`sparks`** (30%) |
| `POST /api/world/combat/death` (no wired client caller — 0 grep hits in `concord-frontend/`) | `routes/world.js:2283` | `handlePlayerDeath` → sparks loot bag | **`sparks`** (30%) |

No wired call site invokes both `dropCorpseOnDeath` and a `handle*Death` on the same death. The two
currencies are genuinely different:

- **`concordia_credits`** (migration `045_concordia_credits.js`) — the real, USD-pegged Concord Coin
  balance. The shadow corpse is a **self-recoverable penalty**: the lost coins return to the *same*
  player on corpse recovery (`recoverCorpse`); the killer never receives them — consistent with
  pvp-loot's "CC never transferred non-consensually" rule.
- **`sparks`** (migration `048_sparks.js`) — a gameplay-only currency with zero real-world value and
  its own `sparks_ledger`; the death drop is a **transferable killer reward** (the killer/claimer or
  killer-NPC gets the sparks).

Different purpose, different currency, different code path, single-fire per event → coherent design,
not a bug. Pinned by `server/tests/death-loot-currency-separation.test.js` (corpse path touches only
`concordia_credits` + writes no `sparks_ledger` row; both sparks paths touch only `sparks` and leave
`concordia_credits` fixed).

---

## 7. Not touched

`loot-generator.js` / `ecosystem/loot-tables.js` internals (read-only for tracing above),
`tool-tree.js`, `content/items.json`, `PROGRESSION_MATRIX.md`, `BALANCE_DIALS.md`,
`npc-simulator.js`, `evo-asset/`, `world-lens-godot/`, `server.js`, all of `concord-frontend/`, and
the node depletion/respawn bookkeeping. The only code change is the gather yield-roll in §5.
