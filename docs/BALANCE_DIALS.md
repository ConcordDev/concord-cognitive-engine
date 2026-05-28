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

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_RESTAURANT_ORDER_TTL_S` | `300` (5 min) | How long an order stays open before expiring. Lower → frantic Diner-Dash; higher → leisurely service. |
| `CONCORD_RESTAURANT_BASE_PRICE_CC` | `15` | Coins per dish before tips. |
| `CONCORD_RESTAURANT_TIP_FRACTION_FAST` | `0.30` | Bonus when served within 30s of order. |
| `CONCORD_RESTAURANT_TIP_FRACTION_OK` | `0.10` | Bonus when served within `ORDER_TTL_S`. |
| `CONCORD_RESTAURANT_TIP_FRACTION_SLOW` | `0` | Bonus when served beyond TTL. |

### Asymmetric Horror (Phase CC6)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_HORROR_DURATION_S` | `1800` (30 min) | Max session length. Lower → tense; higher → drags. |
| `CONCORD_HORROR_EVIDENCE_TO_WIN` | `3` | Distinct sighting kinds investigators must collect to win. Lower → brisk; higher → grindy. |

### Time Loop (Phase CC5)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_TIME_LOOP_DURATION_S` | `1320` (22 min) | Default loop length, à la Outer Wilds. |
| `CONCORD_TIME_LOOPS` | (unset) | Set to `0` to disable time-loops entirely (kill-switch). |

### Programming Puzzle (Phase CC3)

| Env var | Default | Effect |
|---|---|---|
| `CONCORD_CODE_PUZZLE_MAX_CYCLES` | `10000` | Per-test-case execution cap. Lower → tight challenges; higher → permits inefficient solutions. |

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

## When to update this file

- New balance dial added → add a row in the relevant section.
- Existing default changed → update the value column; note the rationale in the commit message.
- Playtest result locks in a new default → update the default in source AND this doc together.
