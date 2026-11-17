// server/lib/currency-map.js
//
// SB-30 — the currency map of record (MEGA PLAN v2, Track B / SB-G5;
// executes the Concordia register's CI-01). Founder-confirmed 2026-11-14
// (MEGA_QUESTIONS answer 2A).
//
// THE MAP. Concord has exactly two currencies going forward:
//
//   SPARKS — gameplay. Everything a player earns or pays by playing:
//     quest and objective rewards, achievement rewards, repair and
//     durability costs, the death penalty, wagers, the world market.
//     Stored in users.sparks with a sparks_ledger row per change
//     (currency.js: awardSparks / spendSparks / transferSparks).
//     Gameplay-only; no real-world value.
//
//   CONCORD COIN — real value. The proceeds of user-made DTU sales
//     between users, settled through the economy ledger
//     (server/economy/**) with the royalty cascade. USD-pegged 1:1 and
//     dollar-backed. Nothing else is Concord Coin.
//
//   concordia_credits — RETIRED. A legacy balance column
//     (users.concordia_credits, migration 045) that gameplay code and
//     sale code both wrote for years, and that comments in the tree
//     wrongly identified AS Concord Coin. It is a SEPARATE balance from
//     the economy-ledger Concord Coin and always was; the identification
//     was the contradiction CI-01 names. Under SB-G5 the column's
//     gameplay paths move to Sparks and its user-sale paths move to the
//     economy ledger, all behind FF_SPARKS_ECONOMY (off by default);
//     the balances themselves move only under SB-36/SB-37's approved
//     mapping script. Nothing user-facing stays named "credits".
//
// This module is the single source the SB-31..SB-37 rows build against:
// every server file that reads or writes concordia_credits is classified
// below with its provenance. The pin
// (server/tests/currency-map-complete.test.js) fails if a file carrying
// the column is missing from this map. The human-readable statement of
// the same map is docs/economy/CURRENCY_MAP.md.

export const CLASS_GAMEPLAY = "GAMEPLAY"; // → Sparks (SB-32/33/34)
export const CLASS_USER_DTU_SALE = "USER_DTU_SALE"; // → Concord Coin via the economy ledger (SB-20)
export const CLASS_SPLIT = "SPLIT"; // provenance decides per flow (SB-34/SB-35)
export const CLASS_SHARED = "SHARED"; // serves both classes; rewritten under the flag (SB-31)

export const CURRENCY_MAP = [
  {
    file: "server/lib/currency-map.js",
    class: CLASS_SHARED,
    provenance:
      "This map itself. It names the column to classify it and performs no reads or writes; it is listed so the completeness pin's census has no silent exception.",
    executingRow: "SB-30",
  },
  {
    file: "server/lib/currency.js",
    class: CLASS_SHARED,
    provenance:
      "The balance reader and the Sparks helpers. getBalances returns { sparks, concordiaCredits } today; SB-31 rewrites it under FF_SPARKS_ECONOMY to { sparks, concordCoin } with the coin read from the economy ledger.",
    executingRow: "SB-31",
  },
  {
    file: "server/lib/quest-rewards.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Quest completion pays the player for playing. Its header's 'gold' denomination is the legacy column's oldest name; the earning is gameplay, so it is Sparks.",
    executingRow: "SB-33",
  },
  {
    file: "server/lib/weekly-objectives.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Weekly objective rewards are gameplay earnings, credited today to the legacy column.",
    executingRow: "SB-34",
  },
  {
    file: "server/lib/achievement-engine.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Achievement rewards already award Sparks via awardSparks; the column appears only in a (corrected) comment and the legacy rewardCc field read. Gameplay earnings are Sparks.",
    executingRow: "SB-34",
  },
  {
    file: "server/lib/gear-durability.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Repair and durability are gameplay costs a player pays from playing, debited today from the legacy column.",
    executingRow: "SB-33",
  },
  {
    file: "server/lib/player-corpse.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "The death penalty is a gameplay mechanic: self-recoverable, the killer never receives it (the death-loot separation invariant). SB-33 keeps it self-recoverable in Sparks.",
    executingRow: "SB-33",
  },
  {
    file: "server/lib/world-buildings-repair.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Building repair is a gameplay cost, debited today from the legacy column.",
    executingRow: "SB-33",
  },
  {
    file: "server/lib/world-health.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "An integrity monitor: it only READS the column to flag negative balances. It follows the column's retirement; the guard's target moves with the balances it watches.",
    executingRow: "SB-33",
  },
  {
    file: "server/lib/world-economy.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "The world market's pricing module. It performs no column reads or writes of its own — its prices are what routes/worlds.js settles — but its denomination is the gameplay one, stated honestly in its JSDoc since SB-30.",
    executingRow: "SB-32",
  },
  {
    file: "server/routes/worlds.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "The world market and resource buy/sell are gameplay trading inside a world; SB-32 moves them to spendSparks/awardSparks. Its market responses carry the new_balance API field (SB-31).",
    executingRow: "SB-32",
  },
  {
    file: "server/routes/player-trade.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Player-to-player trade offers sparks and a 'cc' leg today. SB-33 seats player trade in the gameplay paths: the cc denomination retires and the surface trades in Sparks.",
    executingRow: "SB-33",
  },
  {
    file: "server/routes/wagers.js",
    class: CLASS_GAMEPLAY,
    provenance:
      "Wagers are gameplay stakes held in escrow (BALANCE_COLS maps 'cc' to the legacy column). SB-34 keeps them escrowed atomically, in Sparks.",
    executingRow: "SB-34",
  },
  {
    file: "server/lib/skill-marketplace.js",
    class: CLASS_USER_DTU_SALE,
    provenance:
      "A skill listing is a user-made DTU sold user-to-user (SB-20's own ruling), so its price (the skill_listings.price_cc column) is Concord Coin and settles through the economy ledger, never the legacy column.",
    executingRow: "SB-20",
  },
  {
    file: "server/lib/auctions.js",
    class: CLASS_SPLIT,
    provenance:
      "Provenance decides (SB-35): an auctioned user-made DTU settles in Concord Coin via the economy ledger + cascade; a game-made item settles in Sparks. Meshy/Tripo assets are game-made and not tradeable. The buy-order leg prices in unit_price_cc today.",
    executingRow: "SB-35",
  },
  {
    file: "server/lib/player-mail.js",
    class: CLASS_SPLIT,
    provenance:
      "Mail COD and attachment payments split by what is being paid for (SB-34 step 3): a user-made DTU is Concord Coin; anything else is Sparks. Its lightweight wallet debit reads the legacy column today.",
    executingRow: "SB-34",
  },
];

// API fields that carry the legacy column's value today (SB-30 step 3).
// They retire with their executing rows; nothing new may read them.
export const LEGACY_API_FIELDS = [
  { field: "concordiaCredits", source: "server/lib/currency.js getBalances", executingRow: "SB-31" },
  { field: "new_balance", source: "server/routes/worlds.js world-market responses", executingRow: "SB-31" },
  { field: "price_cc", source: "server/lib/skill-marketplace.js skill_listings column", executingRow: "SB-20" },
  { field: "unit_price_cc", source: "server/lib/auctions.js buy orders", executingRow: "SB-35" },
];

const BY_FILE = new Map(CURRENCY_MAP.map((e) => [e.file, e]));

/** The map entry for a repo-relative server file, or null if unmapped. */
export function currencyClassForFile(file) {
  return BY_FILE.get(file) || null;
}
