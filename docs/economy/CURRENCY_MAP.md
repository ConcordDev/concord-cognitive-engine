# The Currency Map

**Status: founder-confirmed.** Ramaj confirmed this map on 2026-11-14
(MEGA PLAN v2, MEGA_QUESTIONS answer 2A). This document is the
human-readable statement of the map; the machine-readable map of record
is `server/lib/currency-map.js`, and
`server/tests/currency-map-complete.test.js` pins the two together:
every server file that touches the legacy column must appear in the map
with a class. This map executes the Concordia register's CI-01.

## The two currencies

| Currency | What it is | Where it lives | Used for |
|---|---|---|---|
| **Sparks** | Gameplay currency. No real-world value. | `users.sparks` + `sparks_ledger` (via `server/lib/currency.js`) | Everything a player earns or pays by playing |
| **Concord Coin** | Real value, USD-pegged 1:1, dollar-backed. | The economy ledger (`server/economy/**`), settled with the royalty cascade | Proceeds of **user-made DTU sales** between users — and nothing else |

## The retired name

`concordia_credits` (the `users.concordia_credits` column, migration
045) **retires**. For years, gameplay code and sale code both wrote to
this one column, and comments in the tree identified it *as* Concord
Coin ("real money equivalent", "USD-pegged Concord Coin", "Concord Coin
balances live in users.concordia_credits"). That identification was the
contradiction: **`concordia_credits` is a separate balance from the
economy-ledger Concord Coin, and always was.** A player could hold both,
and neither was the other.

Under MEGA PLAN v2 Track B / SB-G5, behind `FF_SPARKS_ECONOMY` (off by
default; no balances move under SB-30):

- every gameplay read/write of the column moves to **Sparks**
  (SB-32, SB-33, SB-34);
- every user-made DTU sale moves to **Concord Coin** through the
  economy ledger (SB-20, SB-35);
- the balances themselves move only under SB-36/SB-37's explicit,
  idempotent, reversible mapping script, run by Dutch's gate (SB-38).

Nothing user-facing stays named "credits". Meshy and Tripo assets are
in-game only and never tradeable.

## Classification of every file that touches the column

Census at the SB-30 premise (FETCH_HEAD 2026-11-14): 48 server files
contain `concordia_credits` — the 14 non-test writers below, migrations
045/415 (excluded; they are history), and 32 test files (excluded; they
pin the writers).

| File | Class | Why (provenance) | Executes in |
|---|---|---|---|
| `server/lib/currency.js` | SHARED | The balance reader + Sparks helpers; `getBalances` is rewritten under the flag | SB-31 |
| `server/lib/quest-rewards.js` | GAMEPLAY → Sparks | Quest completion pays for playing (its "gold" is the column's oldest name) | SB-33 |
| `server/lib/weekly-objectives.js` | GAMEPLAY → Sparks | Objective rewards are gameplay earnings | SB-34 |
| `server/lib/achievement-engine.js` | GAMEPLAY → Sparks | Already awards Sparks; the column survives only in a corrected comment + the legacy `rewardCc` read | SB-34 |
| `server/lib/gear-durability.js` | GAMEPLAY → Sparks | Repair/durability are gameplay costs | SB-33 |
| `server/lib/player-corpse.js` | GAMEPLAY → Sparks | The death penalty: self-recoverable, the killer never receives it | SB-33 |
| `server/lib/world-buildings-repair.js` | GAMEPLAY → Sparks | Building repair is a gameplay cost | SB-33 |
| `server/lib/world-health.js` | GAMEPLAY → Sparks | Integrity monitor; only reads the column (negative-balance guard) and follows its retirement | SB-33 |
| `server/lib/world-economy.js` | GAMEPLAY → Sparks | The world market's pricing module — no column reads/writes of its own; its denomination is the gameplay one | SB-32 |
| `server/routes/worlds.js` | GAMEPLAY → Sparks | World market + resource buy/sell are gameplay trading | SB-32 |
| `server/routes/player-trade.js` | GAMEPLAY → Sparks | Player trade's "cc" leg retires; the surface trades in Sparks | SB-33 |
| `server/routes/wagers.js` | GAMEPLAY → Sparks | Wager escrow's "cc" leg retires; stakes stay escrowed atomically | SB-34 |
| `server/lib/skill-marketplace.js` | USER-DTU-SALE → Concord Coin | A skill listing is a user-made DTU sold user-to-user (SB-20) | SB-20 |
| `server/lib/auctions.js` | SPLIT | User-made DTU → Coin via the ledger; game-made item → Sparks; Meshy/Tripo not tradeable | SB-35 |
| `server/lib/player-mail.js` | SPLIT | COD/attachment payment: user-made DTU → Coin; otherwise Sparks | SB-34 |

## API fields and strings that carry the legacy name

- `concordiaCredits` — returned by `currency.js` `getBalances`
  (SB-31 removes it under the flag; the frontend has 0 references to
  this field).
- `new_balance` — `routes/worlds.js` world-market responses (SB-31).
- `price_cc` — the `skill_listings` price column in
  `server/lib/skill-marketplace.js` (SB-20).
- `unit_price_cc` — auction buy orders in `server/lib/auctions.js`
  (SB-35).
- Frontend consumers of the priced surfaces at the premise date:
  `components/auction/{BuyOrdersPanel.tsx, auction-shared.ts}`,
  `components/concordia/skills/SkillMarketplace.tsx`,
  `components/inheritance/{EstateContext.tsx, MarketPanel.tsx,
  inheritance-shared.ts}`.

## What SB-30 itself changed

Only the contradiction's words: the comments that called the legacy
column real money or Concord Coin are corrected where they stand
(`currency.js`, `achievement-engine.js`, `world-health.js`,
`player-corpse.js` — including its `AS concord_coins` SQL alias — and
the `death-loot-currency-separation` test header), and the world
market's price denomination is stated honestly in `world-economy.js`.
No behaviour changes, no flag is wired, no balance moves.
