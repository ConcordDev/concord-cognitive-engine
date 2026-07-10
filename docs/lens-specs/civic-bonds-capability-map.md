# Civic Bonds Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/civic-bonds.js` (135 LOC) in full, plus its delegate
> `server/lib/civic-bonds.js` (the real micro-bond engine: escrow, the 110%
> funding gate, quorum checks, milestone releases, spillover funds). No
> inline registrations exist elsewhere for this domain (confirmed via
> grep).
>
> Reproduce the macro list:
> `grep -n 'register("civic_bonds"' server/domains/civic-bonds.js`

## Backend surface — 14 macros, all real

| Macro | Real effect | Surfaced (before) | Surfaced (after) |
|---|---|---|---|
| `list` | active bonds per world (public read) | DESIGNED | DESIGNED |
| `get` | single bond + pledges + milestones + quorum | **UNSURFACED** | Still unsurfaced by name — its data is now reachable via `ledger` (see below), which returns the same pledges+milestones without the redundant quorum field |
| `spillover` | restricted residue fund by scope+world (public read) | **UNSURFACED** | Still unsurfaced (see checklist item 6) |
| `ledger` | the public pledge + milestone audit trail — **the lens's own header comment names this as a core feature** ("the public ledger (every pledge)") | **UNSURFACED — a documented feature that was never actually built** | **FIXED THIS SESSION** — `Ledger` disclosure per bond |
| `create` / `open` | propose a bond drive / move it to voting (ruler/leader/officer only) | Not surfaced in this lens by design (see notes) | unchanged |
| `vote` | cast one vote (idempotent per voter) | DESIGNED | DESIGNED |
| `pledge` | escrow sparks toward a bond (denomination-stepped, 5%-of-target single-entity cap) | DESIGNED | DESIGNED |
| `unpledge` | refund your unfilled escrow while the bond is still open | **UNSURFACED** | **FIXED THIS SESSION** — "Unpledge" button |
| `fund` | fund the bond — enforces the 110% pre-funding gate | DESIGNED | DESIGNED |
| `complete_milestone` / `complete` / `fail` | ruler-side lifecycle actions (milestone release, closeout with capped-return payout, failure refund) | Not surfaced in this lens by design (see notes) | unchanged |
| `raid` | the CORRUPT option — divert escrow to treasury, collapses legitimacy + raises refusal_debt | Not surfaced (correctly — this is a narrative/consequence macro for an acting corrupt ruler elsewhere in the world sim, not a casual button) | unchanged |

## 1.5 Reference-parity checklist

**(a) Reference points:** municipal bond / crowdfunding hybrids —
[Kickstarter](https://www.kickstarter.com)'s all-or-nothing funding-gate +
public backer ledger pattern, and real municipal bond transparency
portals (public pledge/spend audit trails). The lens's own doc comment
("the transparency surface for the micro-bond engine") states the target
directly: transparency is the *point* of this lens, not an add-on.

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Browse active bonds with progress-to-target + a funding-gate marker | ALREADY REAL | `list` → progress bar + 110%-gate tick mark |
| 2 | Pledge toward a bond (denomination-stepped, capped) | ALREADY REAL | `pledge`, with client-side mirrored validation of the server's fail-closed numeric guard |
| 3 | Vote on a bond in its voting phase | ALREADY REAL | `vote` |
| 4 | Fund a bond once the gate clears | ALREADY REAL | `fund` |
| 5 | **Public pledge + milestone ledger (the lens's stated core feature)** | **GENUINELY MISSING (pre-session) → FIXED THIS SESSION** | The `ledger` macro was fully real and was even named in the lens's OWN header docstring as one of its four backing features, but no code path ever called it — the transparency promise was undelivered. Added a lazy-loaded "Ledger" disclosure per bond rendering every pledge (entity, amount, escrow status) and every milestone (description, release %, complete/pending) |
| 6 | Refund an unfilled pledge while a bond is still open | **GENUINELY MISSING → FIXED THIS SESSION** | `unpledge` was fully real (refunds escrowed sparks, decrements `current_pledged`) but had no button anywhere. Added an "Unpledge" action next to Pledge for bonds in `voting`/`funding` status |
| 7 | See the restricted spillover fund balance for my world/scope | GENUINELY MISSING | `spillover` is real (per-scope, per-world residue tracking) but this lens has no natural per-scope selector to query it meaningfully (the macro takes an arbitrary `scope` string like `"city"`) — surfacing it well needs a scope picker tied to real world-hierarchy data, deferred as a scoped future build rather than added as a disconnected number |
| 8 | Propose / open a new bond drive from this lens | Not a gap — by design | `create`/`open` are ruler/leader/officer actions; the lens's own empty-state copy ("a realm ruler can open a drive") and header comment scope this lens as the **read + participate** surface, with drive origination belonging to the realm-governance flow elsewhere. Correctly out of scope here, not a defect |
| 9 | Milestone release / bond closeout / failure-refund controls | Not a gap — by design | Same reasoning as #8 — `complete_milestone`/`complete`/`fail` are ruler-side lifecycle actions, not participant actions |
| 10 | The corrupt "raid the escrow" option | Not a gap — by design | `raid` is deliberately not a casual UI button; per the domain file's own comment, "lawful rulers never call this" — it's a narrative consequence path, not a feature to expose generically |

**Coverage summary:** 4 of 10 checklist items already real, 2 fixed this
session (the ledger — closing a real doc-vs-code discrepancy where the
lens's own header comment promised a feature the code never delivered —
and unpledge), 1 genuine scoped gap (spillover needs a scope picker), 3
correctly out-of-scope-by-design (ruler-only lifecycle actions and the
corrupt path, none of which belong in the participant-facing transparency
lens).

## 2. What this rebuild changed

**Closed a doc-vs-code honesty gap.** The lens's own file header
explicitly advertises "the public ledger (every pledge)" as one of its four
backing features, alongside list/pledge/vote/fund — but no UI code ever
called the `ledger` macro. This is the same defect class as a share link
that 404s: a documented capability that silently didn't exist. Fixed by
adding a lazy-loaded, per-bond "Ledger" disclosure (toggled via a "Ledger"
button) that calls `civic_bonds.ledger` and renders every pledge (entity
kind/id, amount, escrow status) and every milestone (description, release
percentage, complete/pending) — real data, no placeholders.

**Wired `unpledge`.** Added an "Unpledge" button (visible while a bond is
in `voting`/`funding` status) that calls `civic_bonds.unpledge` and clears
the cached ledger for that bond so the next expand re-fetches fresh escrow
rows instead of showing stale data.

No generic scaffold was found or removed — this lens had none
(`grade-ux-polish.mjs --honest`: `tier: polished`, `hasMacroButtonWall:
false`, `isGenericScaffold: false` both before and after; the lens is a
single bespoke 204-LOC page, not a generic-CRUD wrapper).

## Files touched

- `concord-frontend/app/lenses/civic-bonds/page.tsx` — added the public
  ledger disclosure (pledges + milestones) and an Unpledge action
- `concord-frontend/tests/civic-bonds-lens-states.test.tsx` — 2 new tests
  pinning the ledger macro call + render and the unpledge macro call
