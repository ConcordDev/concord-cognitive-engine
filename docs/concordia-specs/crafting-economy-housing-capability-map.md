# Crafting / Economy / Itemization / Housing — Capability Map

**Date:** 2026-07-11 · Scope: one lane of a 7-part parallel Concordia audit (crafting, economy,
itemization, player housing/belonging only). Read-only; no code changes made. All claims below were
verified by reading the actual source at the paths cited, not by trusting `docs/MMO_RPG_COMPLETENESS_AUDIT.md`
or `docs/POLISH_AUDIT.md` (both skimmed first per instructions, then independently re-verified).

---

## 1. Summary verdict

**Crafting: genuinely deep, closer to a bespoke ARPG crafting system than a checkbox feature.**
`server/lib/craft-resolve.js#resolveCraft` is a real deterministic potency/affinity/stability
resolver — not a scalar dressed in flavor text. It is wrapped (not duplicated) into all five
crafting surfaces (recipe-DTU crafting, tool-tree, glyph-spell composition, skill-evolution, and
multi-step craft-chains), which is a better architecture than most indie MMOs manage: one math
kernel, five call sites. It benchmarks as **comparable in mechanical depth to a Diablo/Monster
Hunter-style property system**, but **shallower in curated content breadth than WoW professions** —
WoW ships hundreds of hand-tuned recipes per profession; Concordia's "recipe book" is emergent
(players and leveled NPCs *author* recipe DTUs; there is no seeded starter catalog beyond 11
hardcoded tool recipes). That is a legitimate design choice (recipes-as-UGC, citable, royalty-
bearing) but it means a fresh server/world has almost nothing to craft until the population authors
content — the opposite failure mode from WoW's over-stocked trainer list.

**Economy: better than most MMOs actually ship.** There are *two independent, both-real* pricing
mechanisms: a player-driven auction house with bid/buy-now/anti-snipe/buy-orders/order-book depth
(`server/lib/auctions.js`) — genuinely EVE/WoW-AH-grade — and a separate supply/demand engine
(`server/lib/world-economy.js#computeMarketPrice`) that moves NPC-shop prices with actual
gather/trade volume. The long-standing "scarcity never reaches the player" gap flagged in
`POLISH_AUDIT.md` T3.3 is **confirmed fixed** in the current tree (`routes/npc-shop.js:88-96`).

**Itemization: a real WoW/Diablo-style affix + rarity + set-bonus system, wired into combat damage.**
`server/lib/item-affixes.js` (5-tier rarity ladder, prefix/suffix rolls, tiered value ranges) +
`server/lib/item-sets.js` (2/4-piece set bonuses) + `server/lib/gear-durability.js` (death-tied
decay, broken-gear-is-dead-weight) compose into something that would not embarrass a real ARPG.

**Housing: real but shallow relative to Valheim.** Player housing (`server/lib/player-housing.js`)
is a genuine claim→build→decorate→visibility→visit loop with per-coordinate furniture placement and
a 2D grid editor + 3D interior walkthrough on the frontend — not a stub. But "building" itself is
**one-shot prefab placement** (pick a rectangular footprint + material + floor count, pay a flat
material bill, done), not Valheim's piece-by-piece plank/beam/wall/roof snap-construction. A
template gallery (`SnapBuildCatalog`) that *looks* like it would close this gap exists but is
**mounted without its placement callback wired** — it's browse-only.

**Overall:** crafting/itemization/economy are the strongest of the four; housing is the weakest
relative to its named benchmark. None of the four are hollow — every system checked has a real
formula, a real DB write, and (with one exception below) a real caller.

---

## 2. Findings

### 2.1 Crafting — `craft-resolve.js` is genuinely emergent, not a thin multiplier

`server/lib/craft-resolve.js#resolveCraft` (lines 51–129):

- Output potency = `avgInputPotency × 0.7 + skill×0.20 + station×0.15 + magicalFuelBonus + risk×10`,
  clamped 0–100.
- Dominant affinity = the affinity with the highest **summed** potency across inputs (not just
  majority count) — mixing a little rare-tier magic material with a lot of cheap physical material
  can still flip the output's affinity if the magic material's potency dominates the sum.
- Stability = `avgInputStability − (distinctAffinityCount−1)×18 − risk×25`. This is the BotW-style
  "mixed effects" mechanic, but inverted to Concordia's own twist: instead of cancelling to no-effect,
  conflicting affinities lower stability → a **deterministic, seeded** backfire roll
  (`sha1(inputs|skill|station|risk)[0]/255` — no `Math.random()`, so it's contract-testable).
- I hand-computed two cases against the live formula and `RESOURCE_CATALOG` (`server/lib/resources.js`)
  to verify the math is real, not asserted:
  - **Single-material, high-tier craft** — 1× `dragonbone` (T5, potency 90, physical, stability 82),
    playerSkill 80, stationQuality 50, risk 0: `outputPotency = 90×0.7 + 16 + 7.5 = 86.5`,
    single affinity → no conflict penalty → `outputStability = 82`, `backfireChance = 0.18`,
    `qualityMultiplier = 0.5 + 0.865×1.5 = 1.798`. A near-max-tier single-material craft is strong
    but still carries real backfire risk — soft-fail (never a hard lock) per the file's own design note.
  - **Two cheap materials, conflicting affinities** — 1× `iron_ore` (T1, potency 14, physical,
    stability 92) + 1× `herb` (T1, potency 12, bio, stability 70): `avgPotency = 13`,
    two distinct affinities → `conflict = 18`, `outputStability = 81 − 18 = 63`,
    `backfireChance = 0.37`. Two *basic*, low-value materials from different affinity families
    produce a meaningfully risky craft — the system genuinely punishes careless mixing even at the
    bottom of the tier ladder, which is the "distinct trade-offs for strategic depth" bar the doc's
    own design notes cite.
  - This is not guesswork against the code; both are traced through the exact arithmetic in
    `resolveCraft` lines 59–119.
- **Wrap, don't rewrite is real, verified by grep, not just doc claim**: `tool-tree.js#craftTool`
  (line 287 `resolveCraft(...)`), `glyph-spells.js#mintSpell` (line 201, optional fuel-only path),
  `crafting/craft-engine.js#executeCraft` (line 143), `craft-chains.js#advanceStep` (line 204) all
  call the same function. `skill-evolution.js` was not independently re-verified this pass (out of
  primary scope; LIVING_SOCIETY_PLAN.md claims it too).

### 2.2 Resource catalog — 30 canonical kinds, real tier/affinity spread, but a hidden namespace split

`RESOURCE_CATALOG` in `server/lib/resources.js` (lines 18-57) has **30 distinct resource kinds**
across 5 rarity tiers + a magical sub-tier (soul gems petty/grand/black, mana crystal, aether dust,
4 essence flavors). Each carries 7 real numeric/enum properties (potency, affinity, stability,
volume, weight, rarity_tier, source_type). That's shallower than WoW's hundreds of tradeskill mats,
but every entry is genuinely differentiated (not copy-pasted stat blocks) and the schema is
data-only — `content/items.json` demonstrates the extension path (currently only **3** authored
entries, e.g. `lattice_shard`, tier 4 aether-affiliated, with real lore text).

**A concrete, verifiable gap I found by diffing key sets, not by inspection alone**: the propertied-
crafting resource namespace (`RESOURCE_CATALOG`, snake_case ids: `iron_ore`, `mana_crystal`,
`dragonbone`) and the supply/demand market namespace (`BASE_PRICES` in `server/lib/world-economy.js`,
mostly hyphenated ids: `iron-ore`, `mana-crystal`, `dragon-stone`) **only overlap on 3 exact string
ids** (`wood`, `stone`, `crystal`) out of 30 catalog entries / 36 market entries. Since
`propsFor(itemId)` (resources.js line 70) falls through to a generic `DEFAULT_PROPS` (tier-1
physical, potency 10) for any unrecognized id, **most world-market resources a player actually
gathers/trades (iron-ore, mana-crystal, gold-ore, mythril-ore, etc.) are craft-property-invisible** —
they resolve as flat, undifferentiated tier-1 stock in `resolveCraft`, silently losing the depth the
catalog was built for. This is a real, narrow, mechanical seam (not a design judgment) — see gap list.

### 2.3 Recipe breadth — emergent (UGC), not curated; genuinely thin at the fixed-content layer

- **Tool-tree** (`server/lib/tool-tree.js#TOOL_RECIPES`): exactly **11** hardcoded recipes across 5
  tool tiers (bare hands → sharp rock → hammer/chisel/clay-mold → power-tools/laser-cutter →
  legendary forge). This is a fixed progression ladder, not reskins — each tier gates on tool-tier +
  skill level + a distinct material bill — but it is a small, closed set.
- **Craft-chains** (`server/lib/craft-chains.js`): the multi-step engine itself is real (season
  gates, wall-clock duration gates per step, resource bills, output quality resolved from the bill
  via `craft-resolve` at completion). But the only authored content,
  `content/world/concordia-hub/recipes/chains.json` (4 chains: cactem textile, foodstuff annual
  cycle, herbalist tonic, forged blade), is **dead — never loaded**. I grepped the entire `server/`
  and `scripts/` trees for `chains.json` / `recipes/chains` and found zero references outside the
  file itself; `server/lib/content-seeder.js` has no code path that calls
  `registerChain`/reads that file. The macro `craft_chains.register` exists
  (`server/domains/craft-chains.js`) so a chain *could* be registered by hand, but nothing does it
  automatically. **The multi-step chain feature currently has zero live chains on a freshly-booted
  world** unless something outside this codebase seeds them.
- **The bulk of "recipes" are player/NPC-authored DTUs**, not fixed content: `executeCraft`
  (`server/lib/crafting/craft-engine.js`) crafts from a `type='recipe'` DTU any player authored via
  `RecipeAuthorPanel` (referenced in `concord-frontend/app/lenses/crafting/page.tsx`), and
  `npc-marketplace.js#findSellableRecipes` surfaces NPC-authored recipes (level ≥25, ≥3 revisions)
  onto the marketplace. This is architecturally interesting (a recipe is a citable, royalty-bearing
  DTU — crafting plugs directly into the creator economy) but it means recipe *breadth* is a
  population/time function, not a shipped-content function — there is no seeded "recipe book" a
  fresh single-player-equivalent session can lean on beyond the 11 tool recipes + whatever cooking/
  glyph content is seeded elsewhere.
- **Glyph-spell composition** (`server/lib/glyph-spells.js`) is the deepest *combinatorial* system:
  10 seed glyph components, chains of 2–5 components (order matters — `glyphAdd` folds
  sequentially and the dominant element depends on tally), giving a genuinely large distinct-spell
  space from a small authored base, plus an optional magical-fuel amplifier
  (`mintSpell` lines 190-223, potency-proportional, floored at 1.0× so fuel never weakens a spell).
  This is the standout "meaningfully different combos" system in the crafting stack.

### 2.4 Economy — two real pricing mechanisms, not one faked one

- **Player auction house** (`server/lib/auctions.js`): time-bound bidding, anti-snipe (bid inside
  the last 60s extends the auction 60s, `SNIPE_WINDOW_S`/`SNIPE_EXTEND_S`), buy-now settlement,
  5% platform fee (`PLATFORM_FEE_RATE`), a symmetric **buy-order** system (EVE-style — escrow
  `unitPrice × quantity` up front, atomic fill, refund on cancel/expire, `sweepExpiredBuyOrders`
  heartbeat-callable), a real per-item **price-history time series** (`getPriceHistory`, min/max/
  avg/appreciation-%) and **order-book depth** (`getMarketDepth` — aggregated ask/bid ladders with a
  computed spread). This is genuinely comparable to a real game AH, not a listing table.
- **World supply/demand engine** (`server/lib/world-economy.js#computeMarketPrice`): 
  `price = basePrice × clamp(0.2, (demand/supply)×2, 5.0)`. Confirmed **wired**, not orphaned —
  `recordTransaction(db, worldId, resourceId, qty, 'gather')` fires on real gather actions
  (`routes/worlds.js:1745`) and `'trade'` fires on the world market trade route
  (`routes/worlds.js:1983`, `:2014`). **One real gap found**: the function supports a `'craft'`
  transaction type (resources consumed → demand rises) but **no caller anywhere passes `'craft'`** —
  crafting activity never feeds back into world-market price pressure, only gather/trade do. Small,
  precise, easy follow-up (see gap list).
- **NPC-shop scarcity → player price: confirmed FIXED**, contradicting nothing in the current docs
  but worth independently re-verifying since it was a headline "broken" item historically.
  `server/routes/npc-shop.js:88-96` applies `priceModulator(db, shop.worldId, item.resourceKind ||
  item.id)` (bounded [0.75, 1.5] per the comment) to the unit price the player actually pays in
  Sparks. `npc-marketplace.js#priceForRecipeWithScarcity` (the NPC↔NPC-only scarcity function
  `POLISH_AUDIT.md` flagged as dead) **is confirmed dead** — grepped for callers, found none outside
  its own file.
- **Royalty cascade** (`server/economy/royalty-cascade.js`) — not independently re-derived this pass
  (well-documented in CLAUDE.md with constitutional constants: 30% max cascade to ancestors, 2×
  halving per generation, 0.05% floor, 50-deep cap) — spot-checked that a crafted item is a DTU and
  therefore automatically inherits the citation/royalty path; no separate economy needed for UGC
  items to earn royalties.

### 2.5 Itemization — a real rarity/affix/set ladder, wired into combat, not decorative

- **Rarity + affixes** (`server/lib/item-affixes.js`): 5-tier rarity ladder
  (common/uncommon/rare/epic/legendary) → `{ affixCount, maxTierIndex }` — common rolls 0 affixes,
  legendary rolls 4 at the top value tier. 6 prefixes (Keen/Brutal/Flaming/Frozen/Shocking/Venomous)
  × 4 suffixes (of Power/Warding/the Bear/Fury), each with 3 value tiers. These are **real stat
  effects read by the combat damage calc** — `combatEnchantmentFor` (`item-affixes.js:128`) is
  imported at `server/routes/worlds.js:2370` and folds into `attackerStats.enchantmentBonus`, i.e.
  a rolled affix genuinely changes hit damage, not just a tooltip number.
- **Set bonuses** (`server/lib/item-sets.js`): 4 themed sets (Emberforged/Rimewarden/Stormcaller/
  Ironclad), 2-piece and 4-piece thresholds, `set_id` is **inferred from the dominant rolled affix**
  (not authored per-item), so any two Flaming pieces automatically form a set the moment both are
  equipped — no dormant "unauthored set" dead weight.
- **Loot generation is rarity-aware, not flat**: `server/lib/ecosystem/loot-tables.js#rollLoot`
  rolls affixes via `RARITY_RULES` only for equippable drops (regex-detected: sword/blade/armor/
  ring/etc.), applies `setIdForAffixes`, and per-species tables (40+ species across 9 world flavors)
  vary drop rarity by species (e.g. `bear` → `thick-pelt` at `rare`, `deer` → common only). Separately,
  `server/lib/loot-generator.js` (NPC/player death loot) uses `Math.random()` (not seeded) for
  weighted activity-table rolls — appropriate for death loot, distinct code path from the
  species-table system, no rarity/affix wiring on that path (materials/currency only, no equippable
  affix rolls observed in `generateNPCLoot`/`generatePlayerLoot`).
- **Durability is real and load-bearing, not cosmetic**: `server/lib/gear-durability.js` — death-tied
  decay (not per-hit — explicitly designed against WoW's "Block Tax" anti-pattern per the file's own
  header), broken gear (`current_durability === 0`) contributes **zero** affix/set benefit until
  repaired (`item-affixes.js#parseAffixes` and `item-sets.js#getEquipmentSetBonuses` both gate on
  `gearIsBroken`), and `repairAll` is a real atomic CC gold-sink scaling with item level + missing
  durability. This closes the loop WoW/Diablo both rely on for gear as a genuine resource sink.

### 2.6 Housing / belonging — real but shallow vs. Valheim's build-as-progression

- **The house abstraction is a real join, not a stub**: `server/lib/player-housing.js#claimHouse`
  requires the building to sit inside an owned `land_claims` circle (bounding check via `Math.hypot`),
  transfers `world_buildings.owner_*`, and is idempotent on `(land_claim_id, building_id)`.
  `placeFurniture`/`removeFurniture` write **per-coordinate** `{itemId, x, y, z, rot}` entries into
  `building_rooms.furniture_layout_json` (not a flat item-name list — genuine spatial placement),
  debounce a snapshot capture (`scheduleSnapshotCapture`, 5s), and visibility (private/friends/
  public) + a live-vs-snapshot visit mode are real, gated (`canVisit`).
  `concord-frontend/app/lenses/housing/page.tsx` (569 LOC) is a genuinely wired frontend: My-Houses +
  Visit tabs, a 2D grid furniture editor, and (per its own header comment) a 3D walkthrough via
  `HouseInteriorRenderer` when the player physically enters — confirmed by grep, not asserted from
  the page comment alone (`land_claims.list_for_user`, `furniture_layout` both referenced live in
  the page).
- **Land claims are a real territory system**, not decoration: circular claims with overlap
  rejection, an escalating **quadratic** expansion cost (`expandClaim`, `deltaBond ∝ (target² −
  current²)`), maintenance decay that expires unpaid claims, co-owner/guest/tax-collector roles, and
  a permission gate (`canActIn`) that other systems (build, gather, trespass logging) call through.
  This is a legitimate sandbox-MMO land system (closer to Rust/ARK territory claims than to Valheim,
  which has no formal claim system at all).
- **The actual "building" verb is one-shot prefab placement, not incremental construction.**
  `POST /:worldId/buildings` (`server/routes/worlds.js:1850-1922`) takes `building_type` + `material`
  + `floors` + dimensions, checks/deducts a flat material bill (`MATERIAL_COSTS[material].qty_per_floor
  × floors`, e.g. wood 20/floor, steel 10/floor), and inserts one `world_buildings` row. There is no
  piece-by-piece plank/wall/roof/foundation snapping, no structural-support requirement at
  place-time (structural stress from Layer 7.5 only applies *after* placement, from combat/dig
  damage — see CLAUDE.md's `applyStructuralStress`), and no visible construction process — the
  building simply appears. This is the single largest gap against the Valheim benchmark, which is
  built entirely around the *feel* of assembling a structure piece by piece.
  - Partial mitigation exists but isn't reaching this flow: `server/lib/npc-labor-world.js
    #performConstruction` raises **NPC-built** buildings over ticks (frame→construction→standing,
    migration 282 `construction_progress_pct`) — so *NPCs* experience gradual construction, but the
    player-facing route above is instant.
  - **A template gallery that looks like it should add prefab variety is mounted but not wired to
    placement.** `concord-frontend/components/world-lens/SnapBuildCatalog.tsx` (639 LOC) +
    `lib/world-lens/snap-build-templates.ts` (275 LOC, seed templates spanning residential/
    commercial/public/infrastructure/industrial, each with citation-chain "based on" provenance)
    is mounted in `app/lenses/world/page.tsx:6489` as `<SnapBuildCatalog onClose={...} />` **with no
    `onPlaceTemplate` prop passed** — I grepped `app/lenses/world/page.tsx` for `onPlaceTemplate` and
    found zero occurrences outside the component's own prop declaration. The component's `onPlace`
    callback (`SnapBuildCatalog.tsx:171`) is therefore dead in this mount — the catalog is browse-only,
    not a build tool, in its current wiring. (Whether this catalog is meant for the separate
    engineering/city-builder lens rather than player housing wasn't traced this pass — flagged as an
    open question, not asserted as a defect of that other lens.)
- **Seasons + festivals genuinely gate crafting/building, giving Valheim-adjacent "the world has a
  season" texture**: `server/lib/seasons.js` (42-day/6-season year) biases yield/temp/humidity;
  `craft-chains.js` steps honor `season_gate`; `server/emergent/festival-trigger-cycle.js` (freq 4)
  fires calendrical festivals independent of ruler decree. Not independently deep-audited this pass
  (peripheral to crafting/housing) but confirmed wired via `server.js:1095-1096`.

---

## 3. Prioritized gap list (triaged)

1. ~~**[ENGINEERING] Dead multi-step craft-chain content.** `content/world/concordia-hub/recipes/
   chains.json` (4 authored chains) is never loaded by `content-seeder.js` or anything else.~~
   **CLOSED (2026-07-12, `080fe557`)** — `content-seeder.js` now walks every
   `content/world/<world>/recipes/chains.json`.

2. ~~**[ENGINEERING] Resource-id namespace split between crafting and the market.** `RESOURCE_CATALOG`
   (snake_case, crafting-property system) and `BASE_PRICES` (mostly hyphenated, supply/demand
   pricing) overlap on only 3 of ~30-36 ids.~~ **CLOSED (2026-07-12, `dec6d05b`)** — 4 real
   market-id → catalog-id aliases reconciled in `propsFor`.

3. **[ENGINEERING] `world-economy.js`'s `'craft'` transaction type is unused.** The price formula
   already branches on it (resources consumed → demand rises), but no caller passes `type: 'craft'`
   to `recordTransaction`. Wiring `executeCraft`/`craftTool`/chain completion to call it would close
   the loop so crafting activity feeds back into world-market price pressure the way gather/trade
   already do. Small, scoped, mechanical.

4. **[ENGINEERING / design-open] Player building is one-shot prefab, not incremental construction.**
   This is the real Valheim-benchmark gap. Two possible closes, not mutually exclusive: (a) wire
   `SnapBuildCatalog`'s `onPlace` callback through to the existing `POST /:worldId/buildings` route
   (cheapest — the template gallery + citation-chain UGC-provenance system already exists and would
   immediately add prefab *variety*, even without solving the piece-by-piece feel gap); (b) a genuine
   piece-based construction mode (foundation/wall/roof snapping with a live structural-support check
   at place-time, not just post-placement stress) would be a real net-new system, not a small fix —
   flagging as a design decision for whoever owns the housing/building roadmap, not something to
   silently build.

5. **[CURATION] Tool-tree recipe breadth is thin (11 recipes, 5 tiers) relative to WoW professions.**
   This is by design (recipes are meant to be emergent/UGC via recipe DTUs), so it is not a defect,
   but if the intent is for a fresh world to feel craft-rich before the population authors content,
   a larger seeded starter recipe set (in the same DTU shape `RecipeAuthorPanel` produces, so it's
   indistinguishable from a player-authored one) would close the "empty at t=0" gap. Genuinely a
   curation/content-authoring task, not an engineering one — the pipeline to consume such recipes
   already exists end-to-end (`executeCraft`).

6. **[CURATION, low priority] `content/items.json` has only 3 authored materials** beyond the 30-entry
   base `RESOURCE_CATALOG`. The ingestion path (`seedItemBlueprints`) is real and already used
   (confirmed by the one real entry, `lattice_shard`, carrying genuine lore text tying it to the
   Dome Stabilisation narrative event) — this is purely a "more content" ask, no code needed.

No DATA-SOURCING gaps were found in this lane — crafting/economy/itemization/housing are entirely
internal simulation systems with no external-feed dependency (unlike, say, real-estate comps or
recall feeds in other lenses).

---

## 4. Files read (for follow-up work)

`server/lib/craft-resolve.js`, `server/lib/resources.js`, `server/lib/tool-tree.js`,
`server/lib/glyph-spells.js`, `server/lib/craft-chains.js`, `server/domains/craft-chains.js`,
`server/lib/crafting/craft-engine.js`, `server/lib/crafting/station-tiers.js`,
`server/lib/auctions.js`, `server/lib/world-economy.js`, `server/lib/npc-marketplace.js`,
`server/routes/npc-shop.js`, `server/lib/item-affixes.js`, `server/lib/item-sets.js`,
`server/lib/gear-durability.js`, `server/lib/loot-generator.js`, `server/lib/ecosystem/loot-tables.js`,
`server/lib/player-housing.js`, `server/lib/land-claims.js`, `server/routes/worlds.js` (buildings +
market + combat-affix wiring sections), `content/items.json`,
`content/world/concordia-hub/recipes/chains.json`, `concord-frontend/app/lenses/crafting/page.tsx`,
`concord-frontend/app/lenses/housing/page.tsx`,
`concord-frontend/components/world-lens/SnapBuildCatalog.tsx`,
`concord-frontend/lib/world-lens/snap-build-templates.ts`, `docs/MMO_RPG_COMPLETENESS_AUDIT.md`,
`docs/POLISH_AUDIT.md`, `docs/LIVING_SOCIETY_PLAN.md`.
