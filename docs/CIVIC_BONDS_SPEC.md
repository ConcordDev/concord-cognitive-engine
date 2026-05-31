# Spec — Civic Capital: Wire the Micro-Bond Governance Engine into the Political Layer

**Status:** Spec for the working instance to fold into the plan. Not yet built.
**Author context:** Derived from two code audits (realm/treasury + faction/org/governance)
run 2026-05-31, grounded against the user's real-world "Voluntary Micro-Bond
Civic Capital Financing" policy framework.
**Kill-switch:** `CONCORD_CIVIC_BONDS` (default off until wired + tested).

---

## 0. TL;DR

Concordia has a **complete micro-bond governance engine already in the codebase**
— `server/emergent/microbond-governance.js` (919 LOC, 18 exports) — that maps
almost clause-for-clause onto the user's civic-finance policy. **It is dormant:**
in-memory only, no DB tables, no routes, no heartbeat, no UI, not registered.

Meanwhile the political layer is economically **inert**: realm treasuries only
*drain* (decrees spend, nothing collects), `realms.tax_rate` is dead code (set,
never collected), guild treasuries are in-memory (lost on restart), and there is
**no path for a player to voluntarily fund a shared civic project.** Two voting
systems exist (`governance.js`, `council-engine.js`) but neither moves money.

This spec wires the dormant engine to DB + routes + a heartbeat + a lens, and
chains it into the existing political systems so the loop becomes:

> **council petition → micro-bond drive → pre-funded construction decree →
> public ledger → spillover seeds the next project.**

The user's policy safeguards (restricted accounts, 110% pre-funding gate, capped
returns from a restricted pool, single-entity cap, spillover, auto-pause,
transparency) become the **lawful baseline**; a ruler *breaking* them becomes a
**corruption mechanic** wired into the existing `legitimacy` / `character_opinions`
/ schemes / secrets / exile systems.

---

## 1. What already exists (REUSE — do not rebuild)

| Primitive | Location | Role in this spec |
|---|---|---|
| **Micro-bond engine** | `server/emergent/microbond-governance.js` | THE engine. `createBond`, `openBondForVoting`, `voteBond`, `checkQuorum`, `pledgeToBond`, `fundBond`, `activateBond`, `completeMilestone`, `completeBond`, `failBond`, `simulateBond`, `getSpilloverFund`, `getBondMetrics`. In-memory Maps (`_bonds`, `_votes`, `_pledges`, `_spilloverFunds`). Constants: `MAX_SINGLE_ENTITY_RATIO=0.05`, `DEFAULT_SPILLOVER_RATE=0.05`, `DEFAULT_APPROVAL_THRESHOLD=0.6`, `DEFAULT_QUORUM=1000`, `GOVERNANCE_SCOPES` (town→international), `VOTING_STATUSES`. |
| **Restricted escrow pattern** | `server/lib/land-claims.js` | Reference design for "pre-funded, decaying, restricted account": `claimLand` (debits wallet up front), `topUpBond`, `tickMaintenance` (heartbeat-drained). The proven Concordia idiom for restricted capital. |
| **Realm treasury** | `server/lib/kingdoms.js` (`adjustTreasury`), mig 158 `realms.treasury` | Destination for delivered capital + spillover. |
| **Decrees** | `server/lib/kingdom-decrees.js`, mig 158 `realm_decrees` | `construction` (-300) + `festival` (-150) decree kinds already spend treasury. The micro-bond *funds* a construction decree instead of free-spending. |
| **Realm council voting** | `server/lib/council-engine.js`, mig 183 | `openSession`, `submitPetition`, `voteBond`-equiv `tallyVotes`, `playerLobby`. The civic-bond *proposal/approval* gate. |
| **Constitutional voting** | `server/lib/governance.js` | Pattern for quorum + threshold tally; `GOVERNED_CONSTANTS` is where the civic-bond global dials would register if governance-controlled. |
| **Coin service** | `server/economy/coin-service.js` | `mintCoins`/`walletDebit`/`walletCredit` with idempotent `refId`. All pledge/payout money moves through this. |
| **Royalty cascade** | `server/economy/royalty-cascade.js` | The "capped return from a restricted pool" primitive. Bond returns reuse this shape (capped, paid from restricted funds, never from tax/general fund). |
| **Activity feed** | `EmergentEventFeed` (frontend) + `economy_ledger` | The user's "weekly public ledger / project dashboard" transparency requirement. |
| **Legitimacy / opinions / schemes** | `realms.legitimacy`, `character_opinions`, scheme + secret + exile systems | The corruption-consequence layer (§6). |

---

## 2. What's genuinely absent (the gap this spec closes)

1. **DB persistence** for bonds/pledges/votes/milestones (engine is in-memory, dies on restart).
2. **The 110% pre-funding gate** on construction — decrees currently spend treasury with no "fully funded before start" check. This is the user policy's load-bearing safeguard.
3. **Player → civic contribution path** — no way for a citizen to voluntarily fund their realm/faction's project.
4. **Inflow to realm treasury** — `tax_rate` is dead code; nothing collects. The micro-bond is the *voluntary* inflow that replaces the coercive-and-broken tax.
5. **Connective tissue** — council vote, realm decree, and the bond engine don't talk to each other.

---

## 3. Persistence — new migration (append-only, next free number)

Mirror the engine's in-memory shape so `microbond-governance.js` can be refactored
to read/write SQLite with minimal logic change. Tables (all guarded
`CREATE TABLE IF NOT EXISTS`):

```sql
-- The bond itself (one per civic project drive)
CREATE TABLE IF NOT EXISTS civic_bonds (
  id                TEXT PRIMARY KEY,
  world_id          TEXT NOT NULL,
  realm_id          TEXT,                         -- nullable: faction/org/hub bonds allowed
  faction_id        TEXT,
  org_id            TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT,                          -- infrastructure | equipment | civic ...
  scope             TEXT NOT NULL DEFAULT 'city',  -- GOVERNANCE_SCOPES
  -- financial
  target_amount     INTEGER NOT NULL,
  current_pledged   INTEGER NOT NULL DEFAULT 0,
  denomination      INTEGER NOT NULL DEFAULT 100,  -- min pledge unit
  return_rate       REAL NOT NULL DEFAULT 0.005,   -- CAPPED (see §5)
  spillover_rate    REAL NOT NULL DEFAULT 0.05,
  -- governance / lifecycle
  voting_status     TEXT NOT NULL DEFAULT 'proposed', -- VOTING_STATUSES
  quorum            INTEGER NOT NULL DEFAULT 1000,
  approval_threshold REAL NOT NULL DEFAULT 0.6,
  votes_for         INTEGER NOT NULL DEFAULT 0,
  votes_against     INTEGER NOT NULL DEFAULT 0,
  -- the 110% pre-funding gate (user policy core)
  funding_gate_pct  REAL NOT NULL DEFAULT 1.10,
  status            TEXT NOT NULL DEFAULT 'proposed', -- proposed|voting|funding|funded|active|completed|failed|cancelled
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  funded_at         INTEGER,
  completed_at      INTEGER,
  -- the construction decree this bond pays for, once funded
  decree_id         TEXT
);
CREATE INDEX IF NOT EXISTS idx_civic_bonds_world ON civic_bonds(world_id, status);
CREATE INDEX IF NOT EXISTS idx_civic_bonds_realm ON civic_bonds(realm_id);

-- Per-contributor pledges (escrowed up front, refundable until activation)
CREATE TABLE IF NOT EXISTS civic_bond_pledges (
  id                TEXT PRIMARY KEY,
  bond_id           TEXT NOT NULL,
  entity_kind       TEXT NOT NULL DEFAULT 'player', -- player | npc | org | realm
  entity_id         TEXT NOT NULL,
  amount            INTEGER NOT NULL,              -- escrowed (walletDebit at pledge)
  return_reserved   INTEGER NOT NULL DEFAULT 0,    -- capped return escrowed first
  status            TEXT NOT NULL DEFAULT 'escrowed', -- escrowed|delivered|refunded
  pledged_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(bond_id, entity_kind, entity_id)          -- one pledge row per entity per bond
);
CREATE INDEX IF NOT EXISTS idx_civic_pledges_bond ON civic_bond_pledges(bond_id, status);
CREATE INDEX IF NOT EXISTS idx_civic_pledges_entity ON civic_bond_pledges(entity_id);

-- Votes (proposal approval gate)
CREATE TABLE IF NOT EXISTS civic_bond_votes (
  bond_id           TEXT NOT NULL,
  voter_id          TEXT NOT NULL,
  vote              TEXT NOT NULL CHECK(vote IN ('for','against','abstain')),
  cast_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bond_id, voter_id)                  -- idempotent: one vote per voter
);

-- Milestones (fund-release gates + audit checkpoints)
CREATE TABLE IF NOT EXISTS civic_bond_milestones (
  id                TEXT PRIMARY KEY,
  bond_id           TEXT NOT NULL,
  idx               INTEGER NOT NULL,
  description       TEXT,
  release_pct       REAL NOT NULL DEFAULT 0,       -- % of capital released on completion
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|complete
  completed_at      INTEGER,
  UNIQUE(bond_id, idx)
);

-- Spillover by scope (restricted residue; seeds next project)
CREATE TABLE IF NOT EXISTS civic_spillover_funds (
  scope             TEXT PRIMARY KEY,              -- GOVERNANCE_SCOPES
  world_id          TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Refactor note:** keep `microbond-governance.js`'s function signatures identical;
swap the `_bonds`/`_pledges`/`_votes`/`_spilloverFunds` Map reads/writes for the
tables above (pass `db` in, same as every other lib). The lifecycle logic
(`checkQuorum`, `fundBond`, `completeMilestone`, spillover math, the 5% cap) is
already correct — it just needs a persistent backing store.

---

## 4. Routes (`/api/civic-bonds/*`) — all behind `CONCORD_CIVIC_BONDS`

| Method + path | Calls | Gate |
|---|---|---|
| `GET  /api/civic-bonds?worldId=&realmId=&status=` | `listBonds` | public-read |
| `GET  /api/civic-bonds/:id` | `getBond` (+ pledges, milestones) | public-read |
| `POST /api/civic-bonds` (create) | `createBond` | auth; realm ruler / faction leader / org officer only |
| `POST /api/civic-bonds/:id/open` | `openBondForVoting` | proposer/ruler |
| `POST /api/civic-bonds/:id/vote` `{vote}` | `voteBond` + `checkQuorum` | auth; one per voter (PK) |
| `POST /api/civic-bonds/:id/pledge` `{amount}` | `pledgeToBond` → `walletDebit` (escrow) | auth; enforce denomination + 5% cap |
| `POST /api/civic-bonds/:id/unpledge` | refund unfilled escrow → `walletCredit` | auth; pledge owner, only while status ∈ {voting,funding} |
| `POST /api/civic-bonds/:id/fund` | `fundBond` — checks ≥110% gate, escrows returns + admin reserve, then activates + opens construction decree | ruler/leader; gate enforced server-side |
| `GET  /api/civic-bonds/:id/ledger` | full pledge + payout audit trail | public-read (the "weekly public ledger") |

**Macro parity:** register a `civic_bonds` domain (`list`, `get`, `pledge`,
`vote`) so the lens can run through `/api/lens/run` like every other lens.

**Pre-funding gate (the policy's spine), enforced in `fundBond`:**
```
canFund = current_pledged >= target_amount * funding_gate_pct   // default 1.10
fundingOrder (user policy §"Return & cost reserves first"):
  1. escrow return reserve   (sum of per-pledge capped returns)
  2. escrow admin reserve    (capped: MIN(15% of inflow, ceiling))
  3. release project capital (to the construction decree)
  4. spillover ONLY after completeBond closeout
```
**Never** start a project below the gate. No borrowing to fill a gap (mirrors the
land-claim model: no debt, ever).

---

## 5. Returns — capped, restricted-pool only (constitutional)

- Bond `return_rate` is **capped** (default 0.5%, hard ceiling — register under
  `governance.js` `GOVERNED_CONSTANTS` as `civic.return_rate_max` so it can only
  change by governance vote, like the royalty caps).
- Returns are **escrowed at fund time** (funding order step 1) and paid **only
  from restricted bond funds** via `walletCredit` with idempotent `refId`
  (`civic_return:${bondId}:${entityId}`). Reuse the royalty-cascade payout shape.
- **No realm/general-fund guarantee.** If a bond `failBond`s, pledges refund their
  *unspent* escrow; no return is owed (matches the policy's "not principal-
  guaranteed, but structurally low-risk" honesty clause).
- **Single-entity cap** `MAX_SINGLE_ENTITY_RATIO = 0.05` already enforced in
  `pledgeToBond` — keep it.

---

## 6. The lawful/corruption duality (where it becomes Concordia, not a spreadsheet)

The policy safeguards are the **lawful baseline**. A ruler may *defy* them — and
that's the drama, wired into systems that already exist:

| Lawful (policy) | Corrupt option | Existing system that punishes it |
|---|---|---|
| 110% pre-funding gate | start an unfunded vanity project | project stalls (no capital) → `legitimacy` drop |
| capped return from restricted pool | promise returns the pool can't pay | when it can't pay → mass `character_opinions` collapse → citizen loyalty crash (`recomputeCitizenLoyalty`) |
| restricted account, no general-fund touch | raid the bond escrow into treasury | discoverable secret → scheme/blackmail hook (CK3 hooks, `npc_hooks`) → exile decree |
| transparent weekly ledger | hide the ledger | absence is itself a `drift`/audit-exception signal |
| auto-pause on participation collapse | force it to keep running | rising `refusal_debt` / unrest |

So: **honest civic-bond rulers compound legitimacy; corrupt ones blow up** — exactly
the user's Monte Carlo finding ("downside is structurally capped *if rules hold*;
break them and it fails"), turned into emergent political tragedy. No scripting.

---

## 7. Heartbeat — `civic-bond-cycle`

Register via `registerHeartbeat('civic-bond-cycle', { frequency: ~60, scope: 'world', handler })`
(follow the wire-the-unwired orchestrator pattern; wrap in try/catch, always
return `{ ok }`). Each pass:

1. **Auto-pause check** (policy triggers): participation drop >40% window, or a
   bond stuck in `funding` past its deadline → set `status='paused'`, emit event.
2. **Milestone deadlines** → mark overdue, gate further release.
3. **Maturity / completion** → on `completeBond`, run closeout: pay capped returns
   from escrow, compute under-budget residue → `civic_spillover_funds` (restricted),
   credit delivered capital to the realm via `adjustTreasury`.
4. **Spillover reuse** → offer accumulated scope spillover to seed the next bond
   (lower its effective target), per policy "spillover → next project only."

---

## 8. The lens — `/lenses/civic-bonds`

The transparency requirement, as a surface:
- **Active bonds** per world/realm (progress bar to target + the 110% gate line).
- **Pledge** flow (denomination-stepped, shows your escrow + capped return).
- **The public ledger** (`/ledger`) — every pledge, every payout, every milestone.
- **Vote** UI when a bond is `voting`.
- Mount the bond events into `EmergentEventFeed` ("Realm Sandrun funded the Ember
  Bridge — 47 citizens, 12,400 sparks"). This is *also* a legibility win for the
  presentation plan — the living political economy becomes visible.

Register in `lens-registry.ts` + `lens-manifest.js` (the Phase Z1 lesson — a lens
not in the registry is invisible to Ctrl+K + score-lenses).

---

## 9. The connective chain (the whole point)

Wire the three currently-disconnected systems into one loop:

```
council-engine: submitPetition(topic='civic_project')   ← players can petition
        │  tallyVotes → approved
        ▼
civic-bonds: createBond(realm_id, target, milestones)    ← ruler opens the drive
        │  openBondForVoting → voteBond → checkQuorum
        │  pledgeToBond (citizens fund, escrowed, 5% cap)
        │  fundBond  ── enforces ≥110% gate ──┐
        ▼                                     │ funds
kingdom-decrees: construction decree fires ◄──┘          ← pre-funded, not free-spent
        │  build runs (NPC-labor parity = cheaper; §10)
        ▼
completeBond → adjustTreasury(realm, delivered)
            → spillover (restricted) seeds next bond
            → EmergentEventFeed + ledger (transparency)
```

---

## 10. DPW / NPC-labor option (the policy's cost-savings clause)

Per the user's "in-house crews beat contractor markup" point — and Concordia's
NPC-parity work: a funded construction decree may be executed by the realm's **own
NPC work crews / citizen players** at lower cost than hiring outside specialists
(no profit-margin markup). Model as a `labor_source` on the bond: `in_house`
(cheaper, requires the realm have idle worker NPCs / a builder org) vs `contract`
(market rate). Cheaper delivery → larger under-budget residue → more spillover →
faster next project. This makes "a realm with loyal labor builds faster" an
emergent incentive, and ties directly into the emergent service-role economy
(NPC mechanics/builders) from the living-world plan.

---

## 11. Verification

- **Headless unit:** the dormant engine's lifecycle against the new DB store —
  `createBond → open → vote → quorum → pledge (5% cap rejects over-pledge) →
  fund (110% gate rejects underfunded) → milestone → complete → spillover math →
  failBond refunds unspent escrow`. Pin the funding order (returns→admin→capital→
  spillover). Pin idempotency on vote PK + payout refId.
- **Live-server probe:** create a bond on a test realm, pledge from 3 users,
  confirm escrow debits, confirm fund() rejects at 109% and accepts at 110%,
  confirm completeBond credits realm treasury + seeds spillover, confirm the
  corrupt path (raid attempt) drops legitimacy.
- **In-engine (user):** the lens reads as a transparent civic ledger; pledging
  feels like funding *your* kingdom; a corrupt ruler visibly loses the realm.

---

## 12. Build order (fold into the plan as phases)

1. **Migration** (§3) — tables. Kill-switch off.
2. **Refactor** `microbond-governance.js` Maps → DB (signatures unchanged).
3. **Routes + macros** (§4–5) — with the 110% gate + capped returns + 5% cap.
4. **Heartbeat** `civic-bond-cycle` (§7) — auto-pause, milestones, closeout, spillover.
5. **The chain** (§9) — council petition → bond → construction decree → treasury.
6. **Lens** `/lenses/civic-bonds` (§8) + EmergentEventFeed wiring (legibility).
7. **Corruption duality** (§6) — wire raid/over-promise/hide-ledger to legitimacy/
   opinion/scheme consequences.
8. **DPW labor option** (§10) — `labor_source`, in-house cheaper path.

Phases 1–4 light up the core (a working, persistent, safe civic-bond). Phases 5–8
make it political, visible, and dramatic. Each ships behind the kill-switch with
its own tests, same cadence as the rest of the project.

---

## 13. Why this matters (the one-liner for the plan)

> Concordia's political layer is scaffolded but economically inert — treasuries
> that only drain, a tax that never collects, votes that move no money, and a
> complete micro-bond engine sitting unplugged. This spec wires that engine into
> the realm/council/decree systems so civic capital actually *circulates*:
> citizens voluntarily fund their kingdom's projects, returns are capped and
> restricted, projects can't start underfunded, and a ruler who breaks the
> safeguards is punished by systems that already exist. It's mostly *wire the
> dormant engine*, not invent — and it turns kingdoms from territory-with-a-coffer
> into living political economies.
