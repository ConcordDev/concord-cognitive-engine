# Concord — Balance Dials

This file is the canonical reference for every server-side balance constant that's exposed as an environment variable. Defaults are first-draft (Phase D / E shipped without a real playtest pass).

## How overrides work

Every dial below follows the same pattern in source:

```js
const SOMETHING = Number(process.env.CONCORD_SOMETHING) || DEFAULT;
```

Set the env var before booting the server (`docker-compose up`, `npm start`, or `npm run dev`). Booting with an invalid value (non-numeric) falls through to the default.

## Constitutional invariants — DO NOT override

These two are locked by economic + legal contract. They're hardcoded in source and pinned by tests:

| Dial | File | Value | Reason |
|---|---|---|---|
| `MAX_ROYALTY_RATE` | `server/economy/royalty-cascade.js` | `0.30` | Seller-keeps-≥64.54% guarantee. Test `tests/royalty-cascade.test.js`. |
| `WITHDRAWAL_HOLD_HOURS` | `server/economy/withdrawals.js` | `48` | Anti-refund-exploit gate. Test `tests/economy/48h-hold.test.js`. |

## Tunable dials

### Restaurant (Phase CB4)

| Env var | Default | Sim-recommended | Effect |
|---|---|---|---|
| `CONCORD_RESTAURANT_ORDER_TTL_S` | `300` (5 min) | unchanged (playtest) | How long an order stays open before expiring. Lower → frantic Diner-Dash; higher → leisurely service. |
| `CONCORD_RESTAURANT_BASE_PRICE_CC` | `15` | unchanged | Coins per dish before tips. |
| `CONCORD_RESTAURANT_TIP_FRACTION_FAST` | **`0.20`** (T3.4 adopted) | `0.20` ([G3.1](../audit/balance/restaurant-tips.json)) | Bonus when served within 30s of order. |
| `CONCORD_RESTAURANT_TIP_FRACTION_OK` | **`0.15`** (T3.4 adopted) | `0.15` ([G3.1](../audit/balance/restaurant-tips.json)) | Bonus when served within `ORDER_TTL_S`. |
| `CONCORD_RESTAURANT_TIP_FRACTION_SLOW` | `0` | unchanged | Bonus when served beyond TTL. |

**Phase G3.1 sim notes (adopted in T3.4)**: 200 games × 27-cell grid sweep. Best income-variance/expired-ratio cell is fast=0.20, ok=0.15, slow=0.00 (incomeSd=1.42, expiredRatio=0). The prior fast=0.30/ok=0.10 default maximised burst income but added variance; the sim-recommended fast=0.20/ok=0.15 is now the shipped default in `server/lib/restaurant.js:17-19` (env overrides still honoured) — steadier earnings without changing total payout meaningfully.

### Asymmetric Horror (Phase CC6)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_HORROR_DURATION_S` | `1800` (30 min) | Max session length. Lower → tense; higher → drags. |
| `CONCORD_HORROR_EVIDENCE_TO_WIN` | `3` | Distinct sighting kinds investigators must collect to win. Lower → brisk; higher → grindy. |
| `CONCORD_HORROR_DREAD` | `1` | E1 dread substrate kill-switch (`0` disables the terror-radius heartbeat). |
| `CONCORD_HORROR_TERROR_RADIUS_M` | `28` | Distance (m) at which the ghost begins raising dread. |
| `CONCORD_HORROR_CHASE_RADIUS_M` | `10` | Inner radius (m) that flips the chase state → terror music. |
| `CONCORD_HORROR_DREAD_RISE` | `0.18` | Per-tick dread rise toward proximity dread. |
| `CONCORD_HORROR_DREAD_DECAY` | `0.06` | Per-tick dread decay when safe. |
| `CONCORD_HORROR_BLEED_OUT_S` | `45` | Seconds a downed investigator has before bleed-out (rally window). |

### Time Loop (Phase CC5)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_TIME_LOOP_DURATION_S` | `1320` (22 min) | Default loop length, à la Outer Wilds. |
| `CONCORD_TIME_LOOPS` | (unset) | Set to `0` to disable time-loops entirely (kill-switch). |

### Programming Puzzle (Phase CC3)

| Env var | Default | Sim-recommended | Effect |
|---|---|---|---|
| `CONCORD_CODE_PUZZLE_MAX_CYCLES` | `10000` | `10000` ([G3.2](../audit/balance/code-puzzle-cycles.json)) | Per-test-case execution cap. Lower → tight challenges; higher → permits inefficient solutions. |

**Phase G3.2 sim notes**: Puzzles file lacks `reference_solution` fields, so the cycle-budget histogram could not be computed. Default stands. Once reference solutions are authored, re-run `npm run test:sim` to update.

### Player Signs (Death Stranding-pattern async cooperation)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_SIGN_TTL_DAYS` | `7` | Default expiry from placement. |
| `CONCORD_SIGN_MAX_ACTIVE_PER_USER` | `50` | Per-user limit (spam guard). |
| `CONCORD_SIGN_PLACE_COOLDOWN_S` | `60` | Min seconds between placements per user. |
| `CONCORD_SIGN_MESSAGE_MAX_LEN` | `80` | Char cap on sign text. |
| `CONCORD_SIGN_NEARBY_DEFAULT_RADIUS_M` | `60` | Default `signsNearby` lookup radius. |
| `CONCORD_SIGN_MAX_NEARBY_LIMIT` | `200` | Hard ceiling on signs returned in one query. |

### Player Corpse (Dark Souls shadow-corpse)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_CORPSE_COIN_LOSS_FRACTION` | `0.25` | Fraction of wallet dropped on death. |
| `CONCORD_CORPSE_COIN_LOSS_MAX` | `1000` | Absolute cap on coin drop. |
| `CONCORD_CORPSE_RECOVER_RADIUS_M` | `4` | Recovery proximity (metres). Lower → punishing; higher → forgiving. |
| `CONCORD_CORPSE_ACTIVE_TTL_S` | `604800` (7 days) | How long a corpse stays recoverable before going stale. |

## Frontend HUD poll intervals

The frontend HUDs (HordeWaveHUD, ClimbingTracker, TimeLoopHUD, DriftAlertToast, etc.) use hardcoded `POLL_MS` constants for state polling. They're not env-overridable on the server side because the values live in the React component source. Tuning them requires a rebuild. Future work: pass them down from a server-rendered constants endpoint.

## Multi-tenant caps (Phase 11 deploy)

These have been env-overridable since the multi-tenant cap-lift sprint. See CLAUDE.md "Multi-tenant cap defaults" for full table.

| Env var | Default | File |
|---|---|---|
| `CONCORD_DOMAIN_SIGNALS` | `500` | `session-context-accumulator.js` |
| `CONCORD_ACTIVE_LENSES` | `175` | same |
| `CONCORD_SESSION_HISTORY` | `300` | same |
| `CONCORD_DOWNLOADS_PER_USER` | `25` | `storage-constants.js` |
| `CONCORD_DIALOGUE_MAX_CONCURRENT` | `50` | `schema.js` |
| `CONCORD_ARCHIVED_SUMMARIES` | `200` | `conversation-summarizer.js` |
| `MAX_OLD_SPACE_SIZE` | `32768` | node `--max-old-space-size` |

### Combat feel, mastery, intrigue & zones (T-series, this sprint)

These dials were introduced with the T1.4b / T2.1 / T2.3 / T3.3 work and made
tunable in T3.4. Defaults are tuned-by-reasoning (no full playtest yet); each is
bounded so a bad value can't break the game.

| Env var | Default | Bound | File | Effect |
|---|---|---|---|---|
| `CONCORD_KNOCKBACK_SCALE` | `1.0` | 0–3 | `lib/combat/impact-feel.js` | Global multiplier on T1.4b knockback. Lower → grounded/gritty; higher → arcadey shove. Hitstop + wince are unaffected (they read off poise severity). |
| `CONCORD_BEFRIEND_THRESHOLD` | `45` | 0–100 | `lib/embodied/weaponise-triggers.js` | NPC→player opinion (−100..100) that counts as "befriended" and fires a T2.1 befriend weaponise-trigger. Lower → secrets surface sooner; higher → grindier. |
| `CONCORD_SCHEME_OVERHEAR_RADIUS_M` | `12` | 0–100 (m) | `lib/scheme-overhear.js` | How close a player must stand to a plotting NPC to overhear the scheme (T2.3). |
| `CONCORD_HAZARD_DEFAULT_DPS` | `6` | 0–100 | `lib/world-zones.js` | Per-tick damage for a `hazard` zone that doesn't set its own `hazard` in `rules_json` (T3.3). Applied via the Layer-8 pain ledger every ~75s. |

Kill-switches added alongside (set to `0` to disable): `CONCORD_SCHEME_OVERHEAR`
(scheme barge-in), `CONCORD_ZONE_HAZARD` (hazard-zone damage tick).

**E2 combat-feel tune (depth/balance plan, 2026-05-29)** — applied directly in
code (not env-overridable; they're game-feel constants):

| Constant | Old | New | File | Rationale |
|---|---|---|---|---|
| `DEFAULT_BUFFER_MS` | 110 | **90** | `concord-frontend/lib/concordia/combat-input-buffer.ts` | 110 sat at the top of the proven 50–110ms input-buffer range and over-buffered queued specials; 90ms keeps forgiveness without lag (Phase E §1, SF6 ≈5f). |
| `SEVERITY_FEEL.rocked.targetPauseMs` | 115 | **150** | `server/lib/combat/impact-feel.js` | Heavy-tier hitstop toward the SF2 ~167ms benchmark to sell weight. (The old "80ms heavy" was the replaced GameJuice heuristic.) Ordering invariant knockdown(205)>rocked(150)>flinch(55)>none(0) preserved. |

**E1 relative NPC scaling — "the one law" (Phase E §0; depth plan).** Mechanism
shipped but **gated OFF by default** — flipping it on is the playtest step.

| Env var | Default | Bound | Effect |
|---|---|---|---|
| `CONCORD_RELATIVE_SCALING` | off | on/off | Master switch. When ON, NPC combat level is scaled relative to the player's: common NPCs capped below the player (curb-stomp trash → power fantasy), named/boss floored to ~player tier (credible threat → stakes). When OFF, NPCs use their own absolute grown level (unchanged). `server/lib/entity-power.js` |
| `CONCORD_REL_COMMON_LO` / `_HI` | 0.70 / **0.85** | 0–2 | Common-NPC band as a fraction of player level (the cap uses HI). |
| `CONCORD_REL_NAMED_LO` / `_HI` | 1.00 / 1.10 | 0–3 | Named/boss band; the floor uses the midpoint (~1.05×). |

Guarded by `server/tests/integration/balance-dials.test.js` — pins each
default, its bounds, and that an out-of-range/garbage env value falls back to
the default.

## Phase G3 sim — mahjong yaku distribution

500-game dealer-hand sim ([G3.3](../audit/balance/mahjong-yaku.json)) reports a 64.6% win rate over the deterministic seed range. The detection-frequency distribution **does** carry outliers — iipeiko 0.337 (2.06× mean), pinfu 0.046 (0.28×), ittsuu 0.006 (0.04×). That distribution is pure tile-combinatorics, so it cannot be moved by scoring; the balance lever is **reward-tracks-rarity**. T3.4 re-weighted the three outliers in `server/lib/minigame-resolvers.js` so the over-common yaku no longer out-pays the rare ones: **iipeiko 200→100, pinfu 100→250, ittsuu 500→700**. Pinned by `server/tests/integration/mahjong-value-balance.test.js` (the most-common hand can't out-pay a rare one). The earlier "no outliers / no re-weighting recommended" line contradicted the audit and is corrected here.

## How to run the sims

```bash
cd server
npm run test:sim      # runs all G3 sims, regenerates audit/balance/*.json
```

## When to update this file

- New balance dial added → add a row in the relevant section.
- Existing default changed → update the value column; note the rationale in the commit message.
- Playtest result locks in a new default → update the default in source AND this doc together.

## Living World (WS0–WS7) — radial danger gradient, absolute power, migration, fusion

The living-world system ships ON by default; each flag is a kill-switch.

### Master switches
| Flag | Default | Effect when disabled |
|---|---|---|
| `CONCORD_ABSOLUTE_POWER` | on | NPC/creature HP + damage revert to flat 100 HP / `5+criminal_rep*10` |
| `CONCORD_RADIAL_WORLDS` | on | Spawns keep the legacy ±400 footprint; everything stays band 0–1 |
| `CONCORD_WORLD_MIGRATION` | on | Outward NPC re-anchor cycle no-ops |
| `CONCORD_SKILL_FUSION` | on | Crossbreeding/player fusion produces no fused power |
| `CONCORD_FACTION_STRENGTH` | on | Wars/raids ignore structural strength |

### WS0 — radial gradient geometry (`server/lib/world-gradient.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_WORLD_RADIUS_M` | 1000 | Frontier rim; matches TerrainRenderer TERRAIN_SIZE/2. Per-world override via `worlds.rule_modulators.gradient.worldRadiusM`. |
| `CONCORD_GRADIENT_HUB_RADIUS_M` | 150 | Safe hub disc (band 0). |
| `CONCORD_GRADIENT_BANDS` | 6 | Concentric danger bands. |
| `CONCORD_GRADIENT_CURVE` | 1.65 | Super-linear danger ramp (>1 keeps inner bands gentle, spikes the frontier). |
| `CONCORD_GRADIENT_FRONTIER_LEVEL` | 100 | Commons level at the rim (named threats exceed it). |
| `CONCORD_GRADIENT_FRONTIER_DENSITY` | 0.2 | Spawn-density floor at the frontier (1.0 at the hub). |

### WS1 — absolute power (`server/lib/entity-power.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_NPC_BASE_HP` | 100 | Legacy base HP. |
| `CONCORD_NPC_HP_PER_LEVEL` | 0.12 | +12% base HP per level → frontier bullet-sponges. |
| `CONCORD_NPC_BASE_POWER` | 5 | Legacy base attack power. |
| `CONCORD_NPC_POWER_PER_LEVEL` | 0.65 | NPC basePower growth per level. |
| `CONCORD_NPC_DAMAGE_HARD_CAP` | 500 | NPC-side outgoing damage cap. |
| `CONCORD_NPC_DAMAGE_CRIT_MULT` | 3 | cap = min(hardCap, basePower × this). |

### WS3 — migration (`server/lib/world-migration.js`, `emergent/world-migration-cycle.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_MIGRATION_STEP_M` | 40 | Max outward step per NPC re-anchor pass (migration reads as a journey). |

### WS4 — fusion (`server/lib/skill-fusion.js`) + element-combo (`server/lib/combat-polish.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_FUSION_GAIN_MIN` | 1.2 | Unstable fusion multiplier vs the stronger parent. |
| `CONCORD_FUSION_GAIN_MAX` | 1.85 | Perfectly-stable fusion multiplier. |
| `CONCORD_FUSION_GEN_DECAY` | 0.95 | Per-generation diminishing of the fusion bonus. |
| `CONCORD_FUSION_INBRED_PENALTY` | 0.85 | Inbreeding dilution. |
| `CONCORD_FUSION_SINGULARITY_GEN` | 8 | Deep-lineage One-For-All unlock. |
| `CONCORD_FUSION_SINGULARITY_BONUS` | 0.22 | Extra gain at the singularity. |
| `CONCORD_COMBO_ELEMENT_BONUS` | 0.15 | ±15% element-chain amplify/cancel in combat. |

### WS5 — faction strength (`server/lib/faction-strength.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_FACTION_LEADER_WEIGHT` | 4 | Leader level weight in strength. |
| `CONCORD_FACTION_MEMBER_WEIGHT` | 1 | Per-member level weight. |
| `CONCORD_FACTION_COUNT_WEIGHT` | 2.5 | Headcount weight. |
| `CONCORD_FACTION_CONSCRIPTION_BONUS` | 0.25 | Realm-mult bonus when a conscription decree is active. |

### WS7 — telemetry
`GET /api/admin/world-gradient-health` (owner-only) reports per-world band level
distributions + `{ hubLowLevel, veteransOutward }` health flags — the signal that
the hub stays grindable and veterans are draining to the frontier.

### D5 — CK3 hooks (`server/lib/hooks.js`)
Information-as-spendable-leverage. A hook is held by one party OVER another,
derived from a discovered secret; weak = single-use coercion, strong = passive
hostile-scheme block + scheme-success bonus. Both decay.
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_HOOK_TTL_S` | 36288000 (≈ in-world decade, 420×24×3600) | Hook lifetime before decay. |
| `CONCORD_HOOK_STRONG_DIFFICULTY` | 7 | Secret discovery_difficulty ≥ this → strong hook outright. |
| `CONCORD_HOOK_WEAK_USES` | 1 | Coercions a weak hook grants. |
| `CONCORD_HOOK_STRONG_USES` | 3 | Coercions a strong hook grants (plus passive block). |

Non-env constants (edit in source if tuning): `SUCCESS_BONUS_WEAK 10`,
`SUCCESS_BONUS_STRONG 20` (scheme success_pct bump when plotter holds a hook),
`COERCE_OPINION_DELTA −12` (resentment when leverage is spent). `hook-decay-sweep`
heartbeat (freq 240, scope global) GCs expired rows.

### D6 — run-mode payout-on-loss (`roguelite.js`/`horde-mode.js`/`extraction.js`/`run-difficulty.js`)
Every run mode now banks persistent meta-progress into the shared
`roguelite_meta_currency` gem bank on a LOSS, scaled by the risk gradient.
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_HORDE_META_PER_WAVE` | 8 | Horde meta per wave reached (paid on death too). |
| `CONCORD_HORDE_META_PER_KILL` | 0.25 | Horde meta per kill. |
| `CONCORD_EXTRACT_META_PER_ITEM` | 6 | Extraction meta per banked item on a successful extract. |
| `CONCORD_EXTRACT_META_FLAT` | 10 | Flat extract bonus. |
| `CONCORD_EXTRACT_DEATH_CONSOLATION` | 1 | Per-item consolation on death (a wipe still advances meta). |

Roguelite payout = base × `max(1.0, tier loot_mult)` (finder/default never reduced;
heroic 1.5× / mythic 2.5× amplify). `extractionDanger` reuses the horror-dread
`CONCORD_HORROR_TERROR_RADIUS_M` for the final-stretch read.

### E4 — spouse reactivity (`server/lib/spouse-reactivity.js`)
A married NPC reacts to the player's wider-world actions (factions/kills/schemes),
shifting courtship affinity and estranging the marriage when it sours.
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_SPOUSE_FACTION_ALIGN` | 0.06 | Joined the spouse's faction. |
| `CONCORD_SPOUSE_FACTION_RIVAL` | -0.08 | Joined a faction at war/tension with the spouse's. |
| `CONCORD_SPOUSE_BETRAY_OWN` | -0.14 | Betrayed the spouse's own faction (harshest). |
| `CONCORD_SPOUSE_KILL_LIKED` | -0.10 | Killed an NPC the spouse liked (opinion ≥ 20). |
| `CONCORD_SPOUSE_KILL_KIN` | -0.22 | Killed the spouse's kin. |
| `CONCORD_SPOUSE_SCHEME` | -0.05 | Player scheme exposed (cruel/paranoid spouse instead +0.04). |
| `CONCORD_SPOUSE_ESTRANGE_THRESHOLD` | -0.3 | Affinity below this estranges a marriage. |

### E5 — restaurant batching combo (`server/lib/restaurant.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_RESTAURANT_COMBO_WINDOW_S` | 12 | Max gap between serves to keep the combo alive. |
| `CONCORD_RESTAURANT_COMBO_BONUS` | 0.08 | Tip multiplier added per combo step. |
| `CONCORD_RESTAURANT_COMBO_MAX` | 5 | Combo cap. |

### D4#5 — procedural NPC quest-gating secrets (`emergent/procedural-npc-spawner.js`)
| Dial | Default | Notes |
|---|---|---|
| `CONCORD_PROCGEN_SECRET_FRACTION` | 0.33 | Fraction of procedural NPCs whose generated secret is promoted into the discoverable `secrets` table (deterministic per NPC id). |
