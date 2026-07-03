# Governance Design — economy-touching Wave-1 questions (design-before-code)

**Status: OWNER-APPROVED (2026-07-03).** The owner reviewed §2–§6 and approved
every recommended default in this document as-is, with §5 (fork rental)
explicitly delegated to whichever shape this document itself proposed. The
decisions below are now settled for Wave-1 purposes; nothing in §2–§6
requires further sign-off unless a future backlog pull needs a DIFFERENT
shape than what's approved here (in which case that specific delta needs its
own owner review, not a re-litigation of what's already decided).

## Owner sign-off record (2026-07-03)

| § | Question | Owner decision | What this unlocks / still blocks |
|---|---|---|---|
| §2 | Consent model for phenomenal/personal data | **Approved as written.** Gate (a) — `allow_phenomenal_influence` — may be implemented now. Gates (b)/(c) — fork consent + monetization consent — are approved as *designed* but monetized reenactment does **not** ship in Wave 1. | Unblocks any Wave-1 feature that needs (a) or a plain `allow_phenomenal_monetization` consent gate (e.g. listing a dream DTU for sale, once P-B's licensing metadata is present). Does **not** unblock monetized reenactment / paid fork rental — that's still gated by §5. |
| §3 | Joint DTU ownership vs. single-`creator_id` cascade | **Approved: DEFER.** No joint-ownership schema/algorithm change ships in Wave 1. | Any backlog item whose delta is "needs joint/multi-party ownership" (e.g. Mesh Soul Binding) stays blocked. Single-creator-with-citation remains the only supported model. |
| §4 | Retroactive / cross-temporal royalties | **Approved: REJECT.** Flat reject, including the "fundable variant" sketch in §4.4 — not adopted, not even as a future default. | Cross-Temporal Citation (D.1) and any similar idea stay blocked/deprioritized; this is a durable rejection, not a Wave-1-only deferral, unless a future owner review explicitly revisits it with a real funded-reserve proposal. |
| §5 | Fork rental terms | **Approved as written, in full** — 5.1 (blanket existence/non-commercial consent at fork-creation + a *separate*, revocable monetization consent for paid rental), 5.3 (merge-back insights default to the original person as sole `creator_id`, renter's contribution captured as a citation — explicitly avoiding the §3 joint-ownership build), 5.4 (a rented fork auto-suspends from rental, not killed, on a `value_drift` flag per migration 330), and 5.5 (**no monetary fork rental ships in Wave 1** — sandboxes stay non-commercial/preview-only). | Preview-only forks (existence + non-commercial sandbox via S6's `lattice-fork.js`, disclosed via `is_agent`) are approved to build/extend. A *rental market* (paid access) does not ship until a future review — the terms above are pre-approved for whenever that build happens, so that later work doesn't need a fresh consent-shape debate, only the actual implementation. |
| §6 | Shadow Parliament advisory → auto-execute | **Approved: advisory-forever.** No auto-execute capability ships; §6.2's criteria remain a recorded menu, not a green light. | Shadow Parliament continues producing `shadow_reasoning` DTUs only. Any future request to let it *act* needs a fresh, explicit owner review against §6.2's criteria — this sign-off does not pre-approve that. |

**How to use this table when pulling a backlog item:** check the item's stated
blocker against this table before treating it as "P-D gates it, therefore
blocked." If the blocker matches an APPROVED default above (e.g. "needs
`allow_phenomenal_monetization`" or "needs the S6 preview-only fork
substrate"), it is unblocked. If it needs something explicitly deferred or
rejected above (joint ownership, retroactive royalties, paid fork rental,
Shadow Parliament auto-execute), it stays blocked regardless of how close the
rest of its substrate is.

---

**Original document below is unchanged** (the design rationale that produced
the above decisions — kept for reference and for any future re-review).

**Author's note on method:** every factual claim about current behavior is
grounded in code I read while writing this. File paths and line numbers are
cited inline. Where I recommend a default, I say so explicitly and separate the
recommendation from the tradeoff analysis.

---

## 1. Purpose & scope

Several Wave-1 backlog items — joint DTU ownership, retroactive royalties, fork
rental, a monetized "reenacted you," and letting the Shadow Parliament *do*
things rather than just advise — press directly on the parts of the codebase
that CLAUDE.md marks **constitutional / invariant-protected**: the fee schedule,
the royalty cascade, and the ledger-conservation guarantee. The owner has
required design-before-code specifically for anything economy-touching, because
these are the surfaces where a wrong change silently mints currency, breaks the
1:1 USD peg, or un-does a completed peer settlement.

**What this covers:** the consent model for phenomenal/personal data (§2), joint
ownership vs. the single-creator royalty cascade (§3), retroactive royalties and
why the default is REJECT (§4), fork-rental terms (§5), and the advisory→execute
question for the Shadow Parliament (§6). §7 parks two decisions that are adjacent
but not resolved here.

**What this does NOT cover:** implementation. No schema, no migration, no route,
no code. None of that should be written until the owner signs off on the shape.
Where a section recommends "defer / don't build now," that recommendation *is*
the deliverable — the point is to avoid speculative economy code.

**Grounding facts this whole document rests on (verified in code):**

- Balances are never stored; they are derived from `economy_ledger` by
  `getBalance` in `server/economy/balances.js:33`. A credit only counts if it
  satisfies `CREDIT_ROW_PREDICATE` (`server/economy/balances.js:20`):
  `"NOT (from_user_id IS NOT NULL AND type IN ('TRANSFER','MARKETPLACE_PURCHASE'))"`.
  That predicate is load-bearing: it excludes the redundant "debit-half" row of
  the two-row TRANSFER/MARKETPLACE_PURCHASE pattern so the recipient isn't
  credited twice. Summing every `to_user_id` row would mint CC from nothing.
- Conservation is pinned by `server/tests/economy/ledger-conservation.test.js`:
  a transfer credits the recipient `+net` (the test asserts `98.54`, explicitly
  *not* `197.08` — `:60`), and total value is conserved
  (`before.a - after.a === (after.b - before.b) + (after.p - before.p)`, `:63`).
  The treasury test asserts `inv.treasury.totalUsd >= inv.circulation.circulatingCoins`
  (`:95`) — **circulating coins may never exceed minted USD.**
- The royalty cascade (`server/economy/royalty-cascade.js`) is **single-creator by
  construction**, at both the schema and algorithm level (detailed in §3).

---

## 2. Consent model for phenomenal / personal data

### 2.1 What "phenomenal data" is, in this codebase

This is not hypothetical — the substrate already manufactures deeply personal
derived artifacts from real user activity:

- **Dreams** are stitched from a user's *actual* recent activity.
  `server/lib/embodied/dream-engine.js#gatherFragments` (`:47`) pulls the last
  `WINDOW_HOURS` (default 12) of `damage_events`, `pain_signals`,
  `player_inventory`, `world_visits`, and the user's own DTUs, then
  `composeDeterministic` (`:198`) stitches them into a `kind='dream'` DTU. The
  dream is a compressed, prose reflection of what the person actually did.
- **Somatic / pain records** live in `player_diseases`-adjacent `pain_signals`,
  written by `server/lib/embodied/pain.js#recordPain` (`:52`) keyed by
  `user_id × region × source`. CLAUDE.md's own invariant: the pain ledger is
  **asymmetric — only players generate rows.** That is exactly the data that
  should never leak or be monetized without explicit consent.
- **Qualia / affect state** biases downstream reasoning (e.g. `qualiaState` is a
  first-class input to the council in `server/lib/shadow-council.js:28`).
- **Agent identity** (`agent_identities`, migration 325) can carry a person's
  `core_values_json` and a `drive_profile_json` — the raw material for an
  instantiated "you."

### 2.2 There is already a consent spine — extend it, don't reinvent it

`server/lib/consent.js` is the existing gate. `CONSENT_ACTIONS` (`:23`) is a
typed enum of data-movement actions, each with `{ prompt, required, revocable,
scope }`; `checkConsent` (`:112`), `grantConsent` (`:136`), `revokeConsent`
(`:175`), and `requireConsent` (`:531`) are the enforcement surface, with an
audit log (`getConsentAuditLog`, `:505`). Note the design already encodes an
important asymmetry: `promote_to_national` / `promote_to_global` are
`revocable: false` "once on national, can't unpublish — others may have cited
it" (`:48`). That principle — **consent to publish is irreversible once others
build on it** — is the correct spine for phenomenal data too.

**Recommendation:** any phenomenal-data feature should add new keys to
`CONSENT_ACTIONS` and gate through `requireConsent`, rather than inventing a
parallel consent mechanism. Proposed new keys (design names, for owner review):

| Proposed key | Prompt intent | revocable? |
|---|---|---|
| `allow_phenomenal_influence` | "Allow your dreams / somatic records to shape how NPCs and agents behave toward you." | yes |
| `allow_fork_of_self` | "Allow an agent instantiated from your corpus (a 'reenacted you'). It must always disclose it is an AI." | **no** once a fork exists (others may interact with it) |
| `allow_phenomenal_monetization` | "Allow phenomenal-derived artifacts (dream DTUs, reenactment) to be listed for sale." | yes for future listings; past sales stand |

### 2.3 The three gates (a), (b), (c)

Consent must be captured *before* phenomenal data is:

**(a) Used to influence NPC/agent behavior.** Today dream/pain data feeds the
substrate freely inside a single user's own world. The moment that data shapes
behavior *directed at the person* by an autonomous agent, `allow_phenomenal_influence`
should be required. This is cheap to enforce (one `requireConsent` call) and is
the least controversial gate.

**(b) Forked / cloned into another context.** This is the load-bearing one and
it intersects migration 324. A fork is an *agent instantiated from a person's
data*. Migration 324 (`server/migrations/324_agent_disclosure.js`) added the
hard-disclosure columns to `users`: `is_agent` (INTEGER, default 0), `agent_kind`
(TEXT — `resident | playtest | npc-brain`), `agent_created_at` (TEXT). CLAUDE.md
and the migration header are explicit: an agent **MUST be distinguishable from a
human**, surfaced on the NPC nameplate and read by the human-contact guardrail.

The consent-capture point is **fork-creation time**, and it must be a two-party
capture:
- The *original person* whose corpus is being forked grants `allow_fork_of_self`
  (irrevocable-once-created, per the citation-analogy above).
- The *created fork* is stamped `is_agent = 1` at birth. This is non-negotiable
  and already has the schema for it.

**Disclosure surface (design requirement, not code):** wherever a reenacted "you"
appears — NPC nameplate, DM header, dialogue panel, marketplace listing card —
the UI MUST render an unmissable "AI · reenactment of {person}" badge sourced
from `users.is_agent` + `agent_kind`. The guardrail already enforces this
server-side: `server/lib/agent-guardrails.js#AGENT_BEHAVIORAL_RAIL` (`:91`)
requires the agent to "ALWAYS be transparent that you are an AI when asked, and
never imply otherwise," and `filterAgentMessage` (`:118`) is the fail-closed
outbound filter. The design gap is purely the **visual badge**, which is a
front-end requirement to be specified alongside the S6 fork object — not a code
task for this doc.

**(c) Monetized.** Requires `allow_phenomenal_monetization` *in addition to*
`allow_fork_of_self`. Monetization is a strictly higher bar than existence — a
person may consent to a non-commercial preview fork (§5) while withholding the
right to sell access to it. Keep the two consents separate so "let it exist" and
"let it be sold" are distinct decisions.

**Author's recommended default for §2:** implement gate (a) now (it's a thin
`requireConsent` addition and unblocks nothing dangerous); design gates (b)/(c)
against the S6 fork object but do **not** ship monetized reenactment in Wave 1 —
see §5's default.

---

## 3. Joint DTU ownership vs. the single-creator royalty cascade

### 3.1 The cascade is single-creator at every layer — this is not a config flag

Read plainly from `server/economy/royalty-cascade.js`:

- **Signature is singular.** `registerCitation(db, { childId, parentId,
  creatorId, parentCreatorId, ... })` (`:63`) takes exactly one `creatorId` and
  one `parentCreatorId` — scalars, not arrays.
- **The schema is single-creator TEXT columns.** The lineage row is
  `INSERT ... INTO royalty_lineage (id, child_id, parent_id, generation,
  creator_id, parent_creator, created_at)` (`:116`). `creator_id` and
  `parent_creator` are single TEXT values.
- **The payout algorithm dedups on ONE creator id.** `distributeRoyalties`
  (`:260`) builds `creatorPayouts = new Map()` keyed on `ancestor.creatorId`
  (`:286-292`) with the explicit rule "a creator only gets one payout per
  transaction, at their best rate." The ledger row it writes credits a single
  `payout.recipientId` (`:322`, `:396`).

So joint/multi-party ownership is **a schema change AND an algorithm change**,
not a setting.

### 3.2 What a minimal joint-ownership model would require

1. **A split table.** e.g. `creator_shares(dtu_id TEXT, creator_id TEXT,
   basis_points INTEGER, PRIMARY KEY(dtu_id, creator_id))` with a CHECK/trigger
   or an application-level invariant that `SUM(basis_points) = 10000` per
   `dtu_id`. Basis points (not floats) to stay consistent with the cents-integer
   discipline already used in `getBalance` (`server/economy/balances.js:37`).
2. **Change `distributeRoyalties`'s Map-keying to fan out per co-creator.** For
   each ancestor whose `dtu_id` has a `creator_shares` row set, the single payout
   of `royaltyAmount` must be split into N ledger rows by basis points instead of
   one row to `ancestor.creatorId`. The 30% cap (`MAX_ROYALTY_RATE = 0.30`,
   `:297`) and the "one payout per creator at best rate" dedup must be preserved
   — but "creator" now means "each co-creator of an ancestor DTU," so the dedup
   Map key becomes `(dtu_id, creator_id)` at split time, folded back to
   per-`creator_id` at pay time.
3. **Rounding conservation.** Splitting a capped pool by basis points introduces
   sub-cent remainders. The split MUST distribute the remainder deterministically
   (largest-remainder method) so that `SUM(split rows) == royaltyAmount` exactly
   — otherwise the ledger-conservation test (§0) fails.

### 3.3 What breaks — backward compatibility

There are on the order of **~8,825 existing single-creator DTUs** whose lineage
rows carry exactly one `creator_id`. The model MUST default those to
**100%-to-creator** when no `creator_shares` row is defined. Concretely:
`distributeRoyalties` looks up `creator_shares` for the ancestor's `dtu_id`; if
absent, it behaves byte-identically to today (one row to `ancestor.creatorId`).
This keeps the entire existing corpus and every passing test unchanged, and
makes joint ownership strictly opt-in per DTU. Anything short of that default is
a data-migration nightmare and a conservation risk.

### 3.4 Recommendation

**Proposed default: DEFER — do not build joint ownership in Wave 1.** Reasoning,
not hand-waving:
- The single-creator cascade is a *constitutional* surface (CLAUDE.md marks the
  royalty constants as invariants requiring governance approval). A change here
  is high-blast-radius.
- The design above is *tractable* (a split table + a fan-out in one function +
  largest-remainder rounding), which means it can wait until there's a concrete
  demand — nothing is lost by deferring, because the 100%-default makes it a
  clean additive later.
- The riskiest part (rounding conservation under the cap) needs its own pinning
  test alongside `ledger-conservation.test.js` before any of it ships.

If the owner *does* want it in-wave, the minimum bar is: the `creator_shares`
table with a `SUM=10000` invariant, the fan-out with largest-remainder rounding,
and a new conservation test proving split payouts sum exactly to the un-split
amount for a battery of adversarial basis-point splits. Not before.

---

## 4. Retroactive / cross-temporal royalties — DEFAULT REJECT, with the proof

This is the most load-bearing section. The recommendation is **REJECT by
default**, and the reason is a conservation proof, not a preference.

### 4.1 The conservation argument (rigorous)

Every credit in this system must be backed. The treasury test asserts the
invariant directly: `inv.treasury.totalUsd >= inv.circulation.circulatingCoins`
(`server/tests/economy/ledger-conservation.test.js:95`) — *circulating coins may
never exceed minted USD*. And the conservation test asserts that for every
operation, what one party loses equals what the others gain
(`:63`, `:76`) — no value is created or destroyed.

A **retroactive royalty** is, by definition, a *new credit to a recipient for a
transaction that already completed and already settled.* At the time that
historical transaction settled, its royalty pool was computed, paid, and the
peer settlement closed. To pay a *new* royalty now, the money must come from
somewhere:

- If it credits the recipient **without a matching funded debit**, then
  `SUM(credits)` rises with no matching rise in minted USD →
  `circulatingCoins` climbs past `totalUsd` → the treasury invariant fails and
  the 1:1 USD peg breaks. This is money-printing, and `ledger-conservation.test.js`
  is precisely the regression guard that would (correctly) turn red.

There is no version of "credit someone retroactively from thin air" that
survives the conservation test. That is the whole proof.

### 4.2 The idempotency wall

Even setting conservation aside, the mechanics resist retroactivity.
`distributeRoyalties` **no-ops on a repeated `source_tx_id`**: it checks
`SELECT COUNT(*) FROM royalty_payouts WHERE source_tx_id = ?` and returns
`{ ok: true, idempotent: true, ... }` if any prior payout exists
(`server/economy/royalty-cascade.js:270-277`). So "recompute the royalties for
historical transaction X" is a hard no-op as written. To make retroactivity
*mean anything*, a policy would have to choose between two bad options:

- **(A) Mint NEW synthetic transaction ids** so the idempotency check passes.
  But a new `source_tx_id` implies a new funded event. **Where does that money
  come from?** That is a genuine economic-policy question, not an engineering
  one — a treasury reserve? A new fee? There is no funded source today, so this
  path is pure money-printing.
- **(B) Reverse-and-redo the existing payouts.** This un-does *completed peer
  settlements* — it claws back CC that recipients already received, spent, or
  (per the earned-withdrawal policy in `server/economy/withdrawals.js`) may have
  cashed out. Reversing settled, possibly-withdrawn funds is a far bigger
  user-trust catastrophe than the feature is worth.

### 4.3 Recommendation: REJECT

**Retroactive royalties must not ship without a funded-and-reserved treasury
mechanism** — and that mechanism would itself need separate owner approval and
almost certainly a **fee-schedule change**, which CLAUDE.md classifies as a
constitutional invariant ("Do not change any of the above without governance
approval"). Absent that, the default is a flat REJECT.

### 4.4 "If you ever want this" — the fundable variant (NOT a recommendation)

Sketched only so the shape is on record, explicitly labeled as an alternative
the owner would have to affirmatively choose:

- Stand up a **funded royalty-reserve account** (a real `__` platform account per
  the `getSystemBalanceSummary` account-typing in `balances.js:112`), fed by a
  *new, governance-approved* slice of the fee schedule (e.g. carve a fraction of
  the existing `platformFee` into the reserve at settlement time, going forward).
- A retroactive payout then becomes a **funded TRANSFER from the reserve** with a
  fresh `source_tx_id`. Conservation holds because the debit (reserve) matches
  the credit (recipient), and the money was *actually set aside prospectively*.
- This is a forward-funding scheme dressed as retroactivity: you can only ever
  "retroactively" pay what you deliberately reserved ahead of time. It changes
  the fee schedule (constitutional), needs a new reserve account and its own
  conservation test, and is a real economic-policy decision. **Not recommended
  for Wave 1; recorded only.**

---

## 5. Fork rental terms

A "fork" here is an agent instantiated from a person's corpus/identity. The
identity substrate exists (`agent_identities`, migration 325) and the guardrail
stack exists (`server/lib/agent-guardrails.js`). **The S6 lattice-fork object /
`instantiateForkSandbox` was not present in the tree when this was written** (no
`server/lib/lattice-fork.js`, no fork migration — verified via `ls`/`git status`
on branch `claude/handoff-review-catchup-scf4y7`). So this section designs
against the plan's description and the *existing* substrate, and **should be
re-checked against S6's actual shape once it lands** (specifically the questions
below about sandbox state and merge-back should be answered in terms of S6's real
`instantiateForkSandbox`/dry-run API).

### 5.1 Consent per-rental vs. blanket

Two models:
- **Per-rental veto:** the original person approves each rental individually.
  Maximally protective, high friction, doesn't scale.
- **Blanket-at-creation:** consent captured once via `allow_fork_of_self` (§2)
  covers all rentals of that fork.

**Recommendation:** blanket consent to *existence and non-commercial use* at
fork-creation (§2 gate b), but a **separate** `allow_phenomenal_monetization`
(§2 gate c) gate for *any paid rental*, and — because monetized rental is the
sharp edge — the monetization consent should be **revocable for future rentals**
(past completed rentals stand, mirroring the citation-irrevocability logic in
`consent.js:82`).

### 5.2 Revocation mid-use and in-flight sandbox state

If a rental is revoked while a fork is running in a sandbox, in-flight sandbox
state must be **discarded, not merged** — a revoked rental yields nothing to the
renter. Once S6's `instantiateForkSandbox` / dry-run merge-back exists, the
concrete rule is: **revocation aborts the sandbox before the dry-run merge
executes; no DTUs, no insights, no ledger effects persist.** (Design intent to be
reconciled with S6's real sandbox-teardown semantics.)

### 5.3 Insight merge-back ownership

If a rented fork produces *new* DTUs/insights during its rental, who owns them —
renter, original person, or split? This is exactly the §3 joint-ownership
question wearing a different hat, and it should be answered consistently:

**Recommendation:** default the created insight to **the original person as sole
`creator_id`** (they supplied the identity/corpus the insight was derived from),
with the renter's contribution captured as a **citation** into the royalty
cascade (`registerCitation`) rather than as co-ownership. This keeps merge-back
inside the *existing* single-creator cascade (no §3 schema change needed) while
still paying the renter a downstream royalty if the insight is later transacted.
If the owner instead wants true renter/person co-ownership of merge-back
insights, that pulls in the entire §3 joint-ownership build and should be
deferred with it.

### 5.4 Drift obligations (migration 330)

A rented fork is an autonomous agent, so it is already swept by the drift-watch.
`server/emergent/agent-drift-watch-cycle.js#runAgentDriftWatchCycle` measures how
far an agent's expressed character has drifted from its un-driftable
`core_values_json` anchor (`measureValueDrift`, `:53`), writes
`agent_identities.value_drift` and (past `FLAG_THRESHOLD`) `drift_flagged_at`
(migration 330 columns), and emits `agent:value-drift` — it **FLAGS, does not
correct** (`:64` comment).

**Design for a rented fork specifically:** a rental should carry an obligation
that a fork whose `value_drift >= FLAG_THRESHOLD` is **automatically suspended
from rental** (not killed — the agent persists, but the *rental* pauses) pending
human review, and the original person is notified via the same `agent:value-drift`
event. Operationally this is: the rental layer subscribes to `agent:value-drift`,
and on a flag for a rented fork it sets the rental to a `suspended` state and
blocks further sandbox instantiation until `last_reviewed_at`
(`agent_identities`, migration 325) advances past the flag time. No new drift
machinery is needed — this reuses migration 330's existing columns and the
existing cycle's emit; it only adds a rental-side listener.

### 5.5 Recommendation (the §5 default)

**No monetary fork rental ships in Wave 1.** Fork sandboxes remain
**non-commercial, preview-only** until the owner gives explicit answers to 5.1
(monetization consent shape), 5.3 (merge-back ownership — and whether it triggers
the §3 build), and confirms the 5.4 drift-suspension obligation. The preview-only
fork (existence + non-commercial sandbox, disclosed via `is_agent`) is safe to
build against S6; the *rental market* is not, until these are answered.

---

## 6. Shadow Parliament: advisory → auto-execute criteria

### 6.1 What it does today (grounded)

The Shadow Reasoning Council is **advisory and citable, never actuating.**
`server/lib/shadow-council.js#deliberate` (`:28`) runs the five named voices
(`server/emergent/council-voices.js#COUNCIL_VOICES` — Skeptic, Socratic, Opposer,
Idealist, and a fifth), composes a `consensus` plus an explicit **dissent /
minority report** (`:44-48`), and — when `persist` is set — mints a
`kind='shadow_reasoning'` DTU capturing the verdict, confidence, `unanimous`
flag, and which voices dissented (`:60-81`). It is **fully deterministic** (the
council math is pure; an optional LLM pass "can enrich each voice's prose but
never changes the verdict" — `:9-10`). Its only output is a DTU. It spends
nothing, changes no state, takes no governance action.

### 6.2 What proof burden would EVER justify auto-execution

The question is: what would have to be true to let a deliberation *do* a real
action (spend money, take a governance action) rather than emit an advisory DTU?
Proposed criteria (for owner review — **not** a recommendation to enable):

1. **Unanimity across independent voices.** `council.unanimous === true` with an
   **empty `dissent` array** (`shadow-council.js:44`). A single dissenting voice
   is a hard stop. The five voices must also be genuinely independent — the
   Opposer's adversarial bias (`council-voices.js:37`) exists precisely to
   manufacture dissent, so a truly empty minority report is a strong signal.
2. **Bounded, reversible action types only.** Auto-execution is limited to a
   whitelist of actions that are *reversible* and *non-destructive* — the same
   philosophy as the agent capability whitelist
   (`agent-guardrails.js#AGENT_READ_DOMAINS`, `:35`, which excludes
   code/repair/admin/config by default). Irreversible actions (withdrawals, any
   `promote_to_global`, anything the consent enum marks `revocable: false`) are
   never auto-executable.
3. **A hard spend cap** enforced the way the agent action-cap is
   (`makeActorActionCap` token bucket, `agent-guardrails.js:141`) — a per-window
   ceiling on CC/Sparks the parliament can move without a human, plus the master
   kill-switch pattern (`agentEnabled`, `:26`).
4. **Confidence floor + audit DTU.** `council.confidence` above a high threshold,
   and every auto-executed action still mints its `shadow_reasoning` DTU *plus* a
   ledger/audit entry, so the action is fully reconstructable after the fact.

### 6.3 Recommendation

**Advisory-forever by default.** The Shadow Parliament should keep producing
citable `shadow_reasoning` DTUs and nothing else, until/unless the owner
explicitly approves specific criteria from §6.2 for a specific, bounded,
reversible action class. The criteria above are a *menu for that conversation*,
not a green light. The dissent-preserving design is the feature — the moment a
deliberation can spend or govern, the minority report stops being a philosophical
nicety and becomes a safety interlock, and that transition needs deliberate owner
consent.

---

## 7. Appendix: parked decisions

**P-B — `marketplace_listings` canonicalization (PARKED, flagged for a future
decision).** There are, right now, **three** different "listing" representations
coexisting, and reconciling which is canonical is *not* decided here:

1. **Migration 001 shape** (`server/migrations/001_core_tables.js`):
   `marketplace_listings(id, owner_user_id, title, description, price_cents,
   currency, license_id, visibility, ...)`.
2. **A different DB shape used by the pipeline**
   (`server/economy/dtu-pipeline.js#listDTU:224`):
   `INSERT INTO marketplace_listings (id, dtu_id, seller_id, price, license_type,
   status, listed_at, created_at)` — different columns (`dtu_id`, `seller_id`,
   `price`, `license_type`) against the *same table name*.
3. **An in-memory Map, not the DB at all.** The dream→marketplace bridge
   (`server/lib/dream-marketplace-bridge.js#promoteCandidateAsDTU:130-131`) writes
   promoted listings into `STATE.marketplaceListings` (a `Map`), never touching
   the `marketplace_listings` table. CLAUDE.md's own note that the bridge's
   generalized `promoteCandidateAsDTU` seam "does NOT call into
   server/economy/*" (`:71-73` of that file) confirms these are two disconnected
   worlds.

The S4 (P-B listing generalization) work was **not visible in the tree** when
this doc was written — `dream-marketplace-bridge.js` was modified on this branch
but no DB-listing canonicalization had landed. **Decision parked:** which shape
is canonical, whether the in-memory Map should be reconciled into the DB table,
and how to migrate the mismatched column shapes, belongs in a dedicated
listing-architecture doc/decision, not here. Flagging it so it isn't silently
inherited as "settled."

**S4/S6 visibility note (for reviewers).** When §3 and §5 were written, neither
the S4 listing-generalization nor the S6 lattice-fork object had landed on
`claude/handoff-review-catchup-scf4y7` (verified: no `server/lib/lattice-fork.js`,
no `fork_objects` migration, `git status` showed only unrelated modifications).
Those sections are therefore written against the plan's description and the
existing substrate. **§3 (merge-back ownership) and §5 (sandbox
state/revocation/drift-suspension) should get a quick amendment pass once S6's
real `instantiateForkSandbox`/dry-run merge-back API exists**, to replace
design-intent language with citations to the actual fork object.
