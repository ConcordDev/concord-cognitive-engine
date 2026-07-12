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

## Backend surface — 15 macros, all real

**Update (2026-07-12, Wave 4 gap-closure):** a 15th macro, `scopes`, was added
to close checklist item 7 (below) — it returns the real `GOVERNANCE_SCOPES`
hierarchy from `server/emergent/microbond-governance.js` (the legacy sibling
engine this domain's own header comment already names as "the same
conceptual source"), the same list migration 305's `civic_bonds.scope`
column comment points at (`-- GOVERNANCE_SCOPES`). No new table, no invented
data — a read-only re-export of an existing frozen constant.

| Macro | Real effect | Surfaced (before) | Surfaced (after) |
|---|---|---|---|
| `list` | active bonds per world (public read) | DESIGNED | DESIGNED |
| `get` | single bond + pledges + milestones + quorum | **UNSURFACED** | Still unsurfaced by name — its data is now reachable via `ledger` (see below), which returns the same pledges+milestones without the redundant quorum field |
| `spillover` | restricted residue fund by scope+world (public read) | **UNSURFACED** | **FIXED THIS SESSION (2026-07-12)** — real scope-picker panel (see checklist item 7) |
| `scopes` | the real `GOVERNANCE_SCOPES` tiers (town/city/county/state/national/international), for the spillover scope picker (public read) | Did not exist | **NEW THIS SESSION (2026-07-12)** — feeds the spillover scope `<select>` |
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
| 7 | See the restricted spillover fund balance for my world/scope | ~~GENUINELY MISSING~~ **CLOSED (2026-07-12, `f4aa2297`)** | `spillover` is real (per-scope, per-world residue tracking); the missing piece was a natural per-scope selector — the macro takes an arbitrary `scope` string, and this lens had no way to offer real scope options. Traced the domain's own data model (migration 305's `civic_bonds.scope` column comment: `-- GOVERNANCE_SCOPES`) to the real, canonical, frozen `GOVERNANCE_SCOPES` constant in `server/emergent/microbond-governance.js` (the legacy in-memory sibling engine `lib/civic-bonds.js` already calls "the same conceptual source") — a real 6-tier town→city→county→state→national→international hierarchy, not an invented list. Added a `civic_bonds.scopes` read macro re-exporting it, and a new "Restricted spillover fund" panel: a real `<select>` populated from that macro, defaulting to `"city"`, calling `spillover` per selection and showing the true balance (honest `0` when genuinely empty, `Unavailable` on a failed fetch, and the whole panel stays hidden — not a broken empty picker — if scopes never load, e.g. kill-switch off) |
| 8 | Propose / open a new bond drive from this lens | Not a gap — by design | `create`/`open` are ruler/leader/officer actions; the lens's own empty-state copy ("a realm ruler can open a drive") and header comment scope this lens as the **read + participate** surface, with drive origination belonging to the realm-governance flow elsewhere. Correctly out of scope here, not a defect |
| 9 | Milestone release / bond closeout / failure-refund controls | Not a gap — by design | Same reasoning as #8 — `complete_milestone`/`complete`/`fail` are ruler-side lifecycle actions, not participant actions |
| 10 | The corrupt "raid the escrow" option | Not a gap — by design | `raid` is deliberately not a casual UI button; per the domain file's own comment, "lawful rulers never call this" — it's a narrative consequence path, not a feature to expose generically |

**Coverage summary (updated 2026-07-12):** 4 of 10 checklist items already
real, 3 fixed across two sessions (the ledger and unpledge in the first
Wave-3 pass; the spillover per-scope selector in this Wave-4 gap-closure
pass), 3 correctly out-of-scope-by-design (ruler-only lifecycle actions and
the corrupt path, none of which belong in the participant-facing
transparency lens). **0 genuinely missing items remain** — the prior single
scoped gap (spillover's scope picker) is closed.

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

## 3. Wave 4 gap-closure (2026-07-12) — the spillover scope picker

**Closed checklist item 7.** Traced the domain's data model before building
anything: `civic_bonds.scope` (migration 305) is a free `TEXT` column, but
its own inline comment (`-- GOVERNANCE_SCOPES`) points at a real, already-
authored, frozen 6-tier hierarchy — `GOVERNANCE_SCOPES` in
`server/emergent/microbond-governance.js` (`town`, `city`, `county`,
`state`, `national`, `international`), the legacy in-memory sibling engine
`server/lib/civic-bonds.js`'s own header already calls "the same conceptual
source." No new scope taxonomy was invented.

Shipped:
- `server/domains/civic-bonds.js` — new `civic_bonds.scopes` read macro,
  re-exporting `GOVERNANCE_SCOPES` read-only (gated the same as every other
  read macro in this file: `CONCORD_CIVIC_BONDS` kill-switch).
- `concord-frontend/app/lenses/civic-bonds/page.tsx` — a new "Restricted
  spillover fund" panel: fetches the real scope list on mount, renders a
  native `<select>` (defaulting to `"city"` when present), and queries
  `civic_bonds.spillover` for the selected scope + the lens's active world
  on every change. States are honest: a loading balance shows "Loading…", a
  genuinely-zero fund shows "0 sparks" (not hidden or blanked), a failed
  fetch shows "Unavailable", and — critically — the whole panel stays
  unrendered (no broken empty dropdown) until real scopes have actually
  loaded, so a disabled backend or a network failure never shows a fake
  picker.

Tests:
- `server/tests/civic-bonds-macros.test.js` — 3 new cases: `scopes` returns
  the exact real hierarchy, `scopes` gates on the kill-switch like every
  other read, and `spillover` accepts every real scope value and returns an
  honest `0` (no fabricated balance) for scopes with no accumulated residue.
- `concord-frontend/tests/civic-bonds-lens-states.test.tsx` — 3 new cases:
  the picker renders exactly the real `GOVERNANCE_SCOPES` options and the
  real default-scope balance; changing the scope re-queries the macro and
  updates the displayed balance (including a genuinely-zero scope, proving
  the zero isn't a stale/placeholder render); the panel is honestly absent
  when the scopes fetch itself reports disabled.

Verification (all green): `node --check` on the touched backend file;
`eslint` 0 errors/warnings on every touched file (backend + frontend);
backend `node --test` — 11/11 passing across
`civic-bonds-macros.test.js`/`civic-bonds-corruption.test.js`/
`civic-bond-cycle.test.js` (isolated `DB_PATH`, in-memory DB); frontend
`vitest run tests/civic-bonds-lens-states.test.tsx` — 11/11 passing;
project-wide `tsc --noEmit` has exactly one pre-existing error, in
`components/landscaping/GardenStudio.tsx`, from unrelated concurrent work
in this same worktree — zero errors touch this lens.

## Files touched

Wave 3 pass:
- `concord-frontend/app/lenses/civic-bonds/page.tsx` — added the public
  ledger disclosure (pledges + milestones) and an Unpledge action
- `concord-frontend/tests/civic-bonds-lens-states.test.tsx` — 2 new tests
  pinning the ledger macro call + render and the unpledge macro call

Wave 4 gap-closure pass (2026-07-12, this closure):
- `server/domains/civic-bonds.js` — new `civic_bonds.scopes` read macro
- `server/tests/civic-bonds-macros.test.js` — 3 new tests for `scopes` +
  `spillover` scope coverage
- `concord-frontend/app/lenses/civic-bonds/page.tsx` — new "Restricted
  spillover fund" panel (scope `<select>` + real balance display)
- `concord-frontend/tests/civic-bonds-lens-states.test.tsx` — 3 new tests
  pinning the real scope options, scope-change re-query + balance update,
  and the honest hidden-panel state when scopes are unavailable
