# solver.select — fidelity router (SX-XC-01)

The router every catalogue solver is reached through. One solver id,
several fidelity tiers; `solver.select` decides which tier serves a
request and labels the answer with the tier that actually ran.

Code: `server/lib/conkay/select.js` (`registerTier`, `selectTier`,
`runSelected`, `listTieredSolvers`).

## Model

- Tiers are fidelity levels L0–L4, matching the registry's scale. A
  tier may be in-process (no engine) or engine-backed (SXE-00: the
  tier is available only when its engine's binary is present).
- Every pre-existing registry solver is implicitly a tier at its
  declared fidelity with no engine; catalogue solvers register their
  additional tiers explicitly. An explicit tier replaces the registry
  entry at the same level.
- Inputs: `{solverId, tier (requested), ctx, target}`. Units and
  regime are the served solver's own declarations and ride in the
  envelope's solver block, unchanged.

## Selection rules (the envelope is the contract)

1. The highest **available** tier at or below the requested tier
   serves. Nothing ever serves above the request.
2. Serving below the request is labelled: the envelope's solver block
   carries the served tier and `screening: true`. No quiet downgrade.
3. Requested tier engine-blocked, lower tier available → status stays
   **NOT_COMPUTED** with reason `engine_unavailable:<engine-id>`, the
   fast path's outputs ride beside it, and a warning names the blocked
   top tier and the screening fast path that served.
4. Every tier in range engine-blocked → **NOT_COMPUTED**
   `engine_unavailable:<engine-id>`, no outputs. Never a fallback
   number labelled as the engine tier's result.
5. No tier at or below the request → **NOT_COMPUTED**
   `tier_unavailable:<solver>:L<tier>`. Unknown solver →
   **NOT_COMPUTED** `solver_unknown:<solver>`.
6. Input integrity is the registry envelope's own guard: a served
   tier whose echoed inputs disagree with the supplied values comes
   back **NOT_COMPUTED** `input_substituted:<field>`.

## Replay

Walker: `conkay_solver_list` shows each solver's tiers with
`engineDependent` and per-tier `available`. `conkay_solve` for a
tiered solver at its top tier with the engine removed must show
NOT_COMPUTED `engine_unavailable` (with the labelled fast path beside
it where one exists); with the engine present the top tier serves and
the envelope's provenance names that tier.

Reachability note: direct `solve.direct` entry (SC-00) is a separate
foundation ticket; until it seats, the router is reached through
`conkay_solve`'s registry path and `runSelected` in-process.
