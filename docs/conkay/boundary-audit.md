# Boundary audit — NOT_COMPUTED "not modeled" reasons (SXC-25, Q10)

Census at branch `sx/core-loop` head **4593ac8b9** (2026-11-18).
Pin: `server/tests/conkay-boundary-audit.test.js`.

## The rule

A NOT_COMPUTED reason that pleads unmodeled physics ("not
modeled / not modelled / unmodeled / unmodelled") must carry a
**modeling-ticket id** in the same string. An unmodeled boundary
is a ticket, not a shrug: either the physics is modeled by a
named ticket, or the refusal names what it would take.

## Method and classes

Source-text census over the server tree (line scan + a 300-char
window scan after each `notComputed` token, to catch wrapped
reasons). Three classes:

- **Class A — refusal pleas.** A `notComputed` return whose
  reason pleads unmodeled physics.
- **Class B — value-level pleas.** A nested `reason:` on a
  `state: "not computed"` field pleading unmodeled physics.
- **Class C — prose disclosures.** The phrasing in assumptions,
  regime declarations, warnings, source notes, and drawing
  labels. This is the boundary drawn honestly in text — the
  solver *computed* and disclosed what its model omits. Not a
  computation refusal; no ticket required.

## Census results

| Class | Count | Disposition |
|---|---|---|
| A — refusal pleas in `lib/conkay` | **0** of 610 `notComputed` lines | clean; the pin keeps it clean |
| A — wider tree (`lib` + `domains` + `routes`) | **0** of 687 `notComputed` occurrences | clean (census only; the pin covers `lib/conkay`) |
| B — value-level pleas | **1** | unmapped — see below |
| C — prose disclosures | **45** across 26 files in `lib/conkay` | classified disclosure, no ticket required |

Class C concentration, for the record: `structural/frame-fe.js`
8 (buckling-mode omissions), `safety-case/pra-demo.js` 7
(screening end-state omissions), `physics/solvers/long-term-
limit-states.js` 3, five files with 2, the rest 1 each — every
one attached to a solver that computed and disclosed, which is
the honest shape the boundary is supposed to take.

## The one unmapped item (class B)

`server/lib/conkay/physics/solvers/show-solid.js` — the
`doorGapIncrement` field: `state: "not computed"`, reason
*"gaps are not modelled by aero.drag-buildup; no cited
coefficient is used"*.

The refusal itself is honest (no coefficient is invented), but
no modeling ticket owns the door-gap drag increment.
**Disposition:** a modeling ticket is owed by the catalogue
process (an SX-AERO follow-up: door-gap increment for
aero.drag-buildup, from a cited coefficient or a declared
screening model). Until it is seated, the item stands in the
pin's allowlist **by exact set-equality**: any second plea
fails CI, and removing this one without updating the pin and
this doc in the same change also fails CI. The list can only
shrink, in the open.

## What the pin enforces (CI)

1. Class A stays empty unless the pleading string carries a
   ticket id (`SX-…` / `SXE-…` / `SXC-…`).
2. Class B equals the allowlist exactly.
3. Non-vacuity: the scan must see ≥ 250 source files, ≥ 500
   `notComputed` lines, ≥ 30 class-C disclosures — a pin that
   scans nothing passes forever and proves nothing.

## Replay (SXC-23 form)

No solver ships with this ticket. The walker replay is the pin
itself: run `tests/conkay-boundary-audit.test.js` on the
deployed tree → 3/3 green, with the class-B set still exactly
the one named item (or smaller, with this doc updated in the
same change).
