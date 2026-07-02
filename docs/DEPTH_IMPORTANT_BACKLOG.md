# Depth — Importance-Ranked Backlog (what's actually worth behaviorally testing)

_Generated from `audit/macro-depth-honest.json` (regenerated HEAD). Read-only analysis — no code or grader touched._

## Summary

Of **8,915** graded `(domain, macro)` pairs, **3,704** are untested under the honest rubric (`hasTest=false`; 5,211 already carry a real behavioral test or tested delegation). Applying the importance rubric below, only **364 (~10%)** of the untested macros are *worth* a behavioral test — the other **3,340 (~90%) are diminishing-returns small**: catalog/enum getters, formatters, thin `list`/`get`/`detail` wrappers, and tiny validators (`combinedLoc ≤ 25`, no state, no I/O). Chasing those pads the floor score without protecting anything a user can break.

Category breakdown of the 364 important untested macros:

| Category | Count | What's at risk |
|---|---:|---|
| MONEY / economy-touching | 51 | real users' balances, yields, payouts, royalties |
| COMPUTE / correctness | 86 | silently-wrong math/sim (FEA, budgets, glyph algebra, forge, scenarios) |
| GAMEPLAY-visible state mutation | 42 | player-visible DB writes (inventory, boss spawn, skill create, quests) |
| EXTERNAL I/O | 185 | broken third-party contracts — **but only ~14 are deterministic payment/connector integrations; the other 171 are LLM-gated generate/guidance macros with weak deterministic surface** |

The realistic short-term target is therefore closer to **~120 macros** (51 money + 42 gameplay + the ~14 deterministic external + the top ~15 compute), not 3,704.

Spot-checks (5) confirming the picks do real work: `staking.stake`/`redeem` (yield-rate math + `cc_stakes` DB write + owner/lock gating), `retail.cart-create-payment-intent` (subtotal/discount/tax compute → real Stripe `/payment_intents`), `glyph_spells.cast` (schema-correct spell load + license-gate + base-6 element resolution), `forge.refine` (deterministic code-edit rule application), `spawn.boss` (archetype resolution + `world_npcs` insert).

---

## Important untested macros (top ~40)

Columns: `domain.macro` | category | combinedLoc | signals | why it matters. `state`=writes DB, `IO`=external I/O, `rt`=realtime emit, `runsMacro`=calls another macro, `artifact`=artifact write.

### MONEY / economy (51 total — top 12)

| domain.macro | LOC | signals | why it matters |
|---|---:|---|---|
| `marketplace.buy` | 48 | state,rt,artifact | debits buyer / credits seller — release-critical for the peg |
| `marketplace.sell` | 47 | state,rt,artifact | lists + prices an artifact; wrong math strands inventory value |
| `marketplace.issue_license` | 48 | state,rt,artifact | grants usage rights that gate downstream royalty cascade |
| `finance.trade` | 48 | state,rt,artifact | executes a trade against a position |
| `staking.stake` | 27 | state | locks CC, computes yield-rate bps from lock months |
| `staking.redeem` | 26 | state | returns principal + accrued yield; lock/owner gating |
| `dreams.reprice` | 87 | state | mutates listing price of a persisted asset |
| `scope.royaltyPreview` | 58 | state | previews royalty split shown to creators before publish |
| `sponsorship.billing` | 53 | state | bills a sponsor — real invoicing |
| `creator.payout-record` | 43 | state | records a creator payout event |
| `creator.payout-history` | 43 | state | reads payout ledger a creator relies on for taxes |
| `bounty.stake` | 21 | state | escrows CC against a bounty |

_Also flagged (top-25 list): `pharmacy.price-lookup`, `marketplace.ai-optimize-listing`, `market.priceElasticity`, `crypto.live_price`, `foundry.marketplace`, `crafting.marketplace_browse`, `mentorship.request-withdraw`, `insurance.pact-payout-history`, `billing.usage`, `home-improvement.shopping-price-update`, `walker.trade_routes`._

### COMPUTE / correctness (86 total — top 12)

| domain.macro | LOC | signals | why it matters |
|---|---:|---|---|
| `glyph_spells.cast` | 112 | state | base-6 glyph algebra → spell effect + license gate; silent-wrong = broken magic |
| `forge.refine` | 123 | — | deterministic code-edit rule engine; wrong edits corrupt generated apps |
| `forge.createProject` | 105 | — | scaffolds a polyglot single-file app from template |
| `forge.regenerateSection` | 75 | — | regenerates a code section deterministically |
| `forge.sandbox` | 70 | — | validates/executes generated code |
| `rnd.fea` | 91 | — | beam-frame FEA solver — a wrong stiffness matrix is silently wrong |
| `council.simulate-budget` | 71 | state,rt,artifact | budget simulation surfaced to governance |
| `logistics.route-optimize` | 96 | IO | route optimizer; wrong answer looks plausible |
| `anon.privacyRisk` | 103 | — | privacy-risk scoring — a wrong low score leaks |
| `finance.simulate` | 69 | — | financial scenario projection |
| `marketing.budget-pacing` | 57 | state | paces spend against a budget |
| `construction.budget-add`/`-update`/`-list` | 41–56 | state | running budget arithmetic across a project |

_Also: `worldmodel.list_simulations`/`get_simulation`, `urban-planning.scenario-compare`/`-create`, `film-studios.budget-line-add`, `government.budget-breakdown`, `market.sizing-scenarios`, `ethics.stakeholderImpact`._

### GAMEPLAY-visible state mutation (42 total — top 8)

| domain.macro | LOC | signals | why it matters |
|---|---:|---|---|
| `skill.create` | 56 | state,rt,artifact | mints a player skill DTU — visible + tradeable |
| `spawn.boss` | 58 | state,rt | inserts a boss NPC into `world_npcs`; wrong archetype = no encounter |
| `veterinary.inventory-add`/`-adjust`/`-delete` | 55–106 | state | stock-quantity arithmetic a user watches |
| `home-improvement.inventory-add`/`-list` | 40–74 | state | quantity tracking |
| `mentorship.request-send`/`-respond` | 36–70 | state | mig-127 mentorship flow the player initiates |
| `answers.question-ask`/`-edit` | 67–70 | state | user-authored Q&A content persistence |
| `questmarket.abandonClaim`/`leaveGuild`/`myReputation` | 39–58 | state | quest-market membership + rep the player sees |
| `faction_strategy.witness_next_move` | 67 | state | surfaces the emergent faction move to the player |

### EXTERNAL I/O — deterministic payment/connector only (14 of 185; the other 171 are LLM-gated)

| domain.macro | LOC | signals | why it matters |
|---|---:|---|---|
| `retail.cart-create-payment-intent` | 93 | state,IO | real Stripe payment intent + tax/discount compute |
| `retail.cart-confirm-paid-with-intent` | 91 | state,IO | verifies Stripe payment before fulfilment |
| `accounting.invoice-create-payment-link` | 169 | state,IO | Stripe payment-link generation |
| `accounting.bank-feeds-sync` | 116 | state,IO | pulls external bank transactions |
| `healthcare.appointment-charge-copay` | 87 | state,IO | charges a patient copay |
| `import.fetchFromConnector` | 92 | state,IO | the SSRF-guarded connector chokepoint |
| `logistics.shipment-track` | 90 | state,IO | external carrier tracking contract |
| `productivity.calendar-import-ics` | 79 | state,IO | ICS parse/import into calendar |
| `app-maker.connectorTest` | 53 | state,IO | connector round-trip smoke |
| `crawl.fetch` / `aviation.notams-fetch` | 29–47 | state,IO | outbound fetch contract |

> The remaining **171 EXTERNAL macros** are mostly LLM-gated generate/guidance (`food.meal-plan-generate`, `linguistics.pronounce`/`etymology`, `pets.breed-care-guidance`, `ask.answer`, `system.autogen`, `llm.local` at 10,932 LOC). These are excluded from the smoke harness by design and have weak deterministic assertion surface — test their *fallback/validation* paths, not the model output.

---

## Recommended test batches

Group the important set into coherent per-domain batches a single subagent can knock out. Assert style noted per batch.

1. **Economy core — marketplace + staking + bounty** (`marketplace.buy/sell/issue_license`, `staking.stake/redeem`, `bounty.stake`, `finance.trade`) — ~7 macros. Assert **exact-value** (yield-rate bps for a given lock, fee split, escrow amount), **round-trip** (buy → seller balance delta → resell), and **rejection** (min-stake, still-locked redeem, non-owner, empty cart). Highest release-risk batch.

2. **Creator payouts + royalty preview + billing** (`creator.payout-record/-history/-update-status`, `scope.royaltyPreview`, `sponsorship.billing`, `insurance.pact-payout-history`, `billing.usage`) — ~7 macros. Assert **exact-value** royalty split against `MAX_ROYALTY_RATE`/floor invariants and **round-trip** payout record → history read.

3. **Forge code engine** (`forge.createProject`, `forge.refine`, `forge.regenerateSection`, `forge.sandbox`, `forge.share`, `forge.openShare`) — ~6 macros. Assert **round-trip** (create → refine with a known instruction → deterministic edit count) and **rejection** (missing projectId/instruction, unmappable instruction).

4. **Budget + scenario arithmetic** (`construction.budget-add/-update/-list/-delete`, `film-studios.budget-line-add`, `marketing.budget-pacing`, `government.budget-breakdown`, `urban-planning.scenario-create/-compare`, `finance.simulate`, `council.simulate-budget`) — ~11 macros. Assert **exact-value** running totals + variance and **round-trip** add → list reflects the line.

5. **Solver / correctness spot batch** (`rnd.fea`, `glyph_spells.cast`, `anon.privacyRisk`, `logistics.route-optimize`, `market.priceElasticity`) — ~5 macros. Assert **exact-value** against a hand-computed small case (a known beam deflection, a known glyph chain → element, a known elasticity) — these are the "silently wrong" ones.

6. **Gameplay state mutation** (`skill.create`, `spawn.boss`, `veterinary.inventory-add/-adjust/-delete`, `mentorship.request-send/-respond`, `answers.question-ask/-edit`, `questmarket.abandonClaim/leaveGuild`) — ~11 macros. Assert **round-trip** (create → read shows it) and **rejection** (non-owner edit, adjust below zero, duplicate claim).

7. _(optional)_ **Deterministic payment/connector contracts** (`retail.cart-create-payment-intent/-confirm-paid`, `accounting.invoice-create-payment-link/-bank-feeds-sync`, `import.fetchFromConnector`, `healthcare.appointment-charge-copay`) — ~6 macros. Assert the **no-key / validation** path deterministically (Stripe-not-configured rejection, SSRF guard rejection, empty-cart rejection, tax math on the pre-network compute) — the network leg itself needs a live key.

---

## How this differs from `depth-backlog.mjs`

`scripts/depth-backlog.mjs` ranks by **floor-leverage** — how much the honest weighted score moves when a macro flips tested. That ordering favors whatever nudges 0.688 upward fastest, which structurally over-weights the abundant tiny `utility` handlers (each worth a fixed 0.6→1.0 bump) and treats a one-line enum getter and a Stripe charge as near-equivalent. This list inverts that: it ranks by **blast radius if wrong** — money integrity, silently-wrong compute, and player-visible state — and deliberately *ignores* the ~3,340 diminishing-returns small macros even though testing them would raise the score. Use `depth-backlog.mjs` to maximize the number; use this doc to protect the things that actually hurt a user when they break.
