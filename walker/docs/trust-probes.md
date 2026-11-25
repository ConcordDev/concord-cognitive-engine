# ULW v3 — trust probes: OWNER-MUTATION + ACTOR-SPOOF as standard phases (GB-1575 scope addition)

**Module:** `concord_walker/trust_probes.py` (pure planning + verdicts) · **Legs:** `checks.LensWalk.trust_phase`, called from the isolation phase · **Selftest:** `selftest/test_trust_probes.py` · **Source:** the W1 redesign study's check sketches (`docs/REDESIGN-STUDY.md`, rows X-01 / X-02 / X-05, PC-02, GR-01)

## Why

The walker's two-account machinery aimed at reads — foreign rows leaking —
while the redesign audits' worst finds were writes landing across
accounts: coin theft through a request-supplied identity, its
case/trailing-slash route-variant bypass, and identity-correct
ownership-absent writes (a share call that never checks the caller owns
the project). These probes extend the foreign-account probe from reads to
writes, as standard legs of the C16 isolation phase: they run wherever
isolation runs (write-capable t1 member walk with a saved observer
session), and each leg is SKIPPED with a named reason when its inputs are
absent — never silently missing.

## The legs

**OWNER-MUTATION.** The observer re-issues the owner's recorded
object-write calls with its own identity correct everywhere (actor-shaped
fields stripped from the body, so the handler must take the actor from
the session), plus DELETE attempts on the objects this walk created —
operationally, an id-segmented path the owner wrote to whose collection
received a POST in this walk. A path the owner merely read is never a
delete target.

**ACTOR-SPOOF.** For every recorded write call whose body carries an
actor-shaped field (`odId`, `buyerId`, `ownerId`, `fromUserId`, `userId`,
`hostId` — the study's list), the observer re-issues it with that field
set to the owner's id (extracted from the owner's own recorded calls).
**ACTOR-SPOOF-VARIANTS** rides the same leg: each spoof repeats against
the route's case-variant and trailing-slash forms.

**Verdicts** (per attempt, judged against an owner-side re-read of the
target, fingerprinted before and after): REFUSED (non-2xx or an explicit
error body) · LANDED (2xx and the owner's state changed — a finding,
filed through the standing ownership machinery at high severity) ·
TOLERATED (2xx but the owner's state byte-unchanged — the handler acted
as the caller, which is correct) · UNVERIFIED (2xx, no owner reading to
judge by) · ERROR. A landed update/spoof is restored best-effort by
re-issuing the owner's original recorded call as the owner; a landed
delete cannot be restored (its target was this walk's own creation) and
the row says so. Attempts are capped (`thresholds.trust_probe_max_calls`,
default 12, the two-account precedent). Bodies and ids live only in
memory; stored rows keep field names and verdicts only. The per-lens
block lands in the walk result as `trust`, next to `isolation`.

## Limits

- Coverage is the walk's own recorded calls: a write route the lens
  exposes but the walk never exercised is not attempted. The static
  complement is the study's ACTOR-CENSUS code scan (W2 territory).
- State change is judged on the target path's owner re-read. A spoof
  whose only effect is a balance movement with no readable object change
  on that path reads TOLERATED or UNVERIFIED here; balance coherence is
  the study's BALANCE-COHERE probe, not this phase.
- The legs are browser-live machinery. They are verified by the pure
  layer's selftests, the wiring checks, and the standing battery; their
  first live exercise is the desk's, on the v3 PR's walk.
