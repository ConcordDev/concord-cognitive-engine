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
