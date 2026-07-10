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

## Backend surface — 9 macros, all real

| Macro | Real effect | Surfaced (before this pass) | Surfaced (after) |
|---|---|---|---|
| `tracks` | profession taxonomy (categories → tracks → activity) | DESIGNED | DESIGNED |
| `ladder` | a track's 10-tier ladder | **UNSURFACED** | Still unsurfaced (see checklist item 6) |
| `work` | PLAY a shift: skill-input → floor-gated performance resolver → sparks (credited via `creditSparks`, real DB write) + promotion XP | DESIGNED | DESIGNED |
| `contracts` | my contracts (both employer- and worker-side, real `career_contracts` rows) | DESIGNED (read-only list) | DESIGNED — now with negotiation actions |
| `offer` / `accept` / `counter` / `reject` | the full negotiation state machine (`career-contracts.js`): either party offers, the *other* party accepts/counters/rejects, signing bonus pays employer→worker in sparks on accept | **UNSURFACED** — contracts rendered as an inert read-only list even when `status` was `offered`/`countered` and awaiting the player's response | `accept`/`counter`/`reject` now wired (see below). `offer` (originating a new negotiation from the player's side) remains unsurfaced — see checklist item 7 |

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
| 6 | Originate a new contract offer to an NPC/employer from the lens itself | GENUINELY MISSING | `offer` macro exists and is real, but there is no NPC/employer directory in this lens to offer a contract *to* — the negotiation UI this session only handles *responding* to offers a counterparty already made (e.g., via an NPC-side flow elsewhere in the world sim). Building an "offer a contract" composer would need an employer-discovery surface (which NPCs are hiring at what tier), a larger scoped build than a response-actions wire-up |
| 7 | Reputation visibly gates which tiers I can work/contract at | GENUINELY MISSING (surfacing gap only) | `reputationGateTier`/`reputationWageMultiplier` are real and used server-side during `offerContract`, but the player's own reputation number and its tier-gate consequence are never rendered in this lens |

**Coverage summary:** 3 of 7 checklist items already real, 1 fixed this
session (contract negotiation response), 3 genuine scoped gaps named
honestly (ladder preview, offer-origination UI, reputation display) — each
would need additional backend-adjacent surfacing (an NPC/employer
directory, a reputation readout) beyond a straightforward macro-to-button
wire, so deliberately left as documented future work rather than forced
into this pass.

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

## Files touched

- `concord-frontend/app/lenses/careers/page.tsx` — added contract
  negotiation (accept/counter/reject) UI wired to the real macros
- `concord-frontend/tests/careers-lens-states.test.tsx` — 2 new tests
  pinning the negotiation UI (offered contract exposes the 3 actions and
  Accept calls the real macro; an active contract shows none)
