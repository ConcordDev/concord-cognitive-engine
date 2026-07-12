# Careers Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/careers.js` (126 LOC) in full, plus its delegates
> `server/lib/professions.js`, `server/lib/career-fidelity.js`,
> `server/lib/career-engine.js`, `server/lib/sport-minigames.js`,
> `server/lib/career-contracts.js` (the "jobs = sports = one engine"
> composition the domain file's own header describes). No inline
> registrations exist elsewhere for this domain (confirmed via grep).
>
> Reproduce the macro list:
> `grep -n 'register("careers"' server/domains/careers.js`

## Backend surface — 11 macros, all real

(Was 9 at the Wave 3 pass. `employers` and `myReputation` were added in the
Wave 4 gap-closure pass below, closing checklist items 6 and 7.)

| Macro | Real effect | Surfaced (before this pass) | Surfaced (after) |
|---|---|---|---|
| `tracks` | profession taxonomy (categories → tracks → activity) | DESIGNED | DESIGNED |
| `ladder` | a track's 10-tier ladder | **UNSURFACED** | Still unsurfaced (see checklist item 6) |
| `work` | PLAY a shift: skill-input → floor-gated performance resolver → sparks (credited via `creditSparks`, real DB write) + promotion XP | DESIGNED | DESIGNED |
| `contracts` | my contracts (both employer- and worker-side, real `career_contracts` rows) | DESIGNED (read-only list) | DESIGNED — now with negotiation actions |
| `offer` / `accept` / `counter` / `reject` | the full negotiation state machine (`career-contracts.js`): either party offers, the *other* party accepts/counters/rejects, signing bonus pays employer→worker in sparks on accept | **UNSURFACED** — contracts rendered as an inert read-only list even when `status` was `offered`/`countered` and awaiting the player's response | `accept`/`counter`/`reject` wired the Wave 3 pass. `offer` (originating a new negotiation from the player's side) is now wired too — ~~remains unsurfaced~~ **CLOSED (2026-07-12, `0b9fcd40`)**, see checklist item 6 |
| `employers` *(new)* | NPC employer directory for a track — READ-ONLY archetype→track derivation over `world_npcs` (`server/lib/career-employers.js`), never fabricated | did not exist | DESIGNED — `<EmployerBrowser>` (`concord-frontend/components/careers/EmployerBrowser.tsx`), see checklist item 6 |
| `myReputation` *(new)* | the player's real reputation for a track (`server/lib/career-contracts.js#deriveWorkerReputation`) + the exact `reputationGateTier`/`reputationWageMultiplier` values `offerContract` enforces | did not exist | DESIGNED — `<ReputationGate>` (`concord-frontend/components/careers/ReputationGate.tsx`) + locked-tier markers on the ladder, see checklist item 7 |

## 1.5 Reference-parity checklist

**(a) Reference points:** [Stardew Valley](https://www.stardewvalley.net)'s
job/contract-adjacent town-request board and, more directly, real gig/
contract-negotiation platforms like [Upwork](https://www.upwork.com) (offer
→ counter → accept flow, signing terms visible to both parties before
committing). The domain's own framing (a shared "jobs = sports" engine with
tiers, wages, and reputation-gated contracting) is closest to a
career-sim + gig-marketplace hybrid, so both references apply.

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Browse a profession taxonomy by category | ALREADY REAL | `tracks` → "Professions" section |
| 2 | Play/work a shift with a skill input driving a real payout | ALREADY REAL | `work` — real floor-gated resolver, real sparks credit (`creditSparks`), real promotion XP |
| 3 | View my active/pending contracts | ALREADY REAL | `contracts` list |
| 4 | Respond to a pending contract offer (accept / counter / decline) | **GENUINELY MISSING → FIXED THIS SESSION** | The backend has a complete offer→counter→accept→reject state machine (`career-contracts.js`) with a real signing-bonus wallet transfer on accept, but the UI only ever *listed* contracts — a contract sitting in `status: 'offered'` awaiting the player's response rendered identically to an active one, with no way to respond. Wired `accept`/`counter`/`reject` as inline controls on any contract whose status is `offered`/`countered` |
| 5 | See a track's full tier ladder (wage progression, reputation gates) before committing to work it | GENUINELY MISSING | `ladder` macro is real (`ladderFor(trackId)`, 10 tiers) but has no UI — a player picks a track and tier blind. Scoped future build: a ladder preview under the track select |
| 6 | ~~Originate a new contract offer to an NPC/employer from the lens itself~~ | GENUINELY MISSING → **CLOSED (2026-07-12, `0b9fcd40`)** | Built the employer-discovery surface: a new `careers.employers` macro (`server/lib/career-employers.js#findEmployers`) reads real `world_npcs` rows and derives "is this NPC hiring, at what track/tier" from a fixed, documented `archetype → track[]` table (e.g. `trader→[trader]`, `healer→[medic]`, `scholar→[mage,detective]`) — an archetype absent from the table is honestly excluded, never guessed, so flavor archetypes (`vampire_noble`, `syndicate_matriarch`, …) never appear as fake employers. The offered tier is derived from the NPC's real `level` column (`clamp(ceil(level/3), 1, 10)`), not invented. The frontend's new `<EmployerBrowser>` component (`concord-frontend/components/careers/EmployerBrowser.tsx`) lists discovered NPCs for the selected track and a **Propose contract** flow lets the player enter real terms (base wage, signing bonus) and calls the real `careers.offer` macro with `employerKind:'npc'`/`employerId:<discovered npc>`/`workerKind:'player'`/`workerId:<the signed-in player>` — a designed form, not a raw JSON paste. |
| 7 | ~~Reputation visibly gates which tiers I can work/contract at~~ | GENUINELY MISSING (surfacing gap only) → **CLOSED (2026-07-12, `0b9fcd40`)** | Added `careers.myReputation`, which calls a new `deriveWorkerReputation(db, workerKind, workerId, trackId)` (`server/lib/career-contracts.js`) — a grounded, non-fabricated number built from two real signals this domain already writes: signed (`active`/`completed`) `career_contracts` rows as the worker (20 pts each) and worked-shift `sparks_txn_refs` rows from `careers.work` (4 pts each), saturating at 100 — then runs it through the SAME `reputationGateTier`/`reputationWageMultiplier` functions `offerContract` enforces server-side, so the number shown can never drift from what actually gates an offer. Also hardened `careers.offer` itself: when the player is the worker party (the flow `<EmployerBrowser>` drives), the server now computes `workerReputation` itself via `deriveWorkerReputation` instead of trusting a client-supplied value — a client can no longer spoof a high reputation to bypass the tier gate. The frontend's new `<ReputationGate>` component (`concord-frontend/components/careers/ReputationGate.tsx`) renders the reputation bar + gated-tier list, and reports the gated tiers up to the page so the tier ladder marks locked rungs with a lock icon. |

**Coverage summary:** 5 of 7 checklist items now real (3 already real + 2
closed this pass), 1 fixed a prior session (contract negotiation response),
1 genuine scoped gap remains named honestly (the tier-ladder preview UI,
item 5 — `ladder` macro is real but still has no dedicated preview surface
beyond what the ladder section already renders inline).

## 2. What this rebuild changed

**Wired contract negotiation.** `app/lenses/careers/page.tsx`'s "My
contracts" section previously rendered every contract identically
regardless of `status`. Any contract in `offered`/`countered` status now
shows inline **Accept** / **Counter** (with a wage-amount input) /
**Reject** actions, calling the real `careers.accept`/`careers.counter`/
`careers.reject` macros and refreshing the list on completion, with success/
error toasts. The backend already validated everything correctly (a party
cannot accept their own standing offer, `career-contracts.js` enforces this
via `party(byKind,byId) === c.last_offer_by`) — the client doesn't need to
know the exact `last_offer_by` encoding itself; it shows the controls for
any negotiable contract and lets the server be the source of truth on
whether a given action is legal, surfacing the server's rejection reason
if not.

No generic scaffold was found or removed — this lens had none
(`grade-ux-polish.mjs --honest`: `tier: polished`, `hasMacroButtonWall:
false`, `isGenericScaffold: false` both before and after).

## 3. Wave 4 gap-closure (2026-07-12) — employer discovery + reputation

Closed checklist items 6 and 7 (see the table above for the full detail).
Two new backend macros (`careers.employers`, `careers.myReputation`) and two
new frontend components (`<EmployerBrowser>`, `<ReputationGate>`), all
read-only against real data — no NPC behavior was created or changed, only
queried; `world_npcs` reads are additive and don't touch the money/economy
invariants beyond routing the existing `careers.offer` macro's real
signing-bonus wallet transfer at a real, discovered NPC id instead of an
arbitrary client-supplied string.

The archetype→track mapping (`server/lib/career-employers.js#ARCHETYPE_HIRES_FOR`)
is deliberately conservative: only archetypes with a clear, defensible
correspondence to one of the 12 `professions.js` tracks are mapped (e.g.
`trader→trader`, `healer→medic`, `engineer→[smith,hacker]`); the dozens of
narrative/flavor archetypes seeded across the sub-worlds (`vampire_noble`,
`syndicate_matriarch`, `link_walker`, …) are intentionally left unmapped and
therefore never appear as employers — this is the honesty contract the
checklist item demanded, not an oversight.

## Files touched

- `server/domains/careers.js` — new `employers`/`myReputation` macros;
  `offer` now computes the player-worker's reputation server-side via
  `deriveWorkerReputation` instead of trusting a client-supplied value
- `server/lib/career-employers.js` *(new)* — `findEmployers`,
  `tracksForArchetype`, `ARCHETYPE_HIRES_FOR`
- `server/lib/career-contracts.js` — new `deriveWorkerReputation`
- `server/tests/career-employers.test.js` *(new)*, `server/tests/career-contracts.test.js`
  (new `deriveWorkerReputation` suite), `server/tests/careers-domain-macros.test.js`
  (new `employers`/`myReputation`/self-reputation-offer coverage)
- `concord-frontend/components/careers/EmployerBrowser.tsx` *(new)*,
  `concord-frontend/components/careers/ReputationGate.tsx` *(new)*
- `concord-frontend/app/lenses/careers/page.tsx` — mounts both new
  components; the tier ladder now marks reputation-gated tiers locked
- `concord-frontend/tests/components/EmployerBrowser.test.tsx` *(new)*,
  `concord-frontend/tests/components/ReputationGate.test.tsx` *(new)*,
  `concord-frontend/tests/careers-lens-states.test.tsx` — added a signed-out
  `useAuth` mock (both new components consume the hook)

Prior pass (contract negotiation response):

- `concord-frontend/app/lenses/careers/page.tsx` — added contract
  negotiation (accept/counter/reject) UI wired to the real macros
- `concord-frontend/tests/careers-lens-states.test.tsx` — 2 new tests
  pinning the negotiation UI (offered contract exposes the 3 actions and
  Accept calls the real macro; an active contract shows none)
