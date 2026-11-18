# orc.realistic-fallback — the closest realistic version of an impossible request

Solver id: `orc.realistic-fallback` · v1.0.0 · domain: orchestration · fidelity L3
Source: `server/lib/conkay/orc/realistic-fallback.js`
Engine tier: SXE-21 (declared `engineDependent`; NOT_COMPUTED in every result)

## What it does

When a request violates a solver envelope, this solver never
refuses and never improvises a number: it solves the
min-distance relaxation in requirement space against the
**declared** constraints and ships the answer **with its
envelope** (CB-0835 rule 2), worded **"closest within the
stated envelope"**.

The relaxation rule is the founder's F10 ruling (Ramaj,
2026-11-18, adopting the catalogue planner's recommendation
entire):

1. **Priorities first.** "must" / "at least" / "ideally" rank
   the requirements — an explicit `priority` field, or the
   words in the requirement's own `source` text. A
   higher-priority requirement is held while any feasible
   relaxation moves only lower-priority ones; a "must" that an
   envelope forces anyway is flagged `mustRelaxed`, never
   hidden.
2. **Min-max relative change.** Otherwise relax so as to
   minimize the largest relative change against the requested
   bound values.
3. **Alternatives.** The primary version first, plus up to two
   Pareto alternatives (each relaxing a different requirement),
   all fully computed and verified against every declared
   constraint.
4. **Citations.** Every change names the solver envelope
   (solver + citation) that forced it.

## Inputs and the declared constraint model

Inputs (node props under the literal key `orc.realisticFallback`):
`{requirements, constraints?}`.

- `requirements` — the requested bounds in the
  orc.requirements shape: `{metric, bound: {kind: "max"|"min",
  si, unit, given?}, priority?, source?}`. One bound per
  metric; every bound carries its declared unit (a bare number
  is refused, SC-04) and a positive finite SI value.
- `constraints` — the stated envelope, as data:
  - `{kind: "limit", metric, bound, envelope: {solver,
    citation}}` — a per-metric achievable bound (e.g. an
    energy ceiling computed by a feasibility solver at the
    requested design point).
  - `{kind: "ratio", numerator, denominator, bound, envelope}`
    — a pairwise bound `achievedNum/achievedDen <= si` (or
    `>=`), the tyre-friction shape.

The JS tier solves this model exactly: limits compose
directly; a ratio over two metrics is solved in closed form
(the balanced min-max, or the priority-held single-side
relaxation). A constraint interaction the closed forms cannot
compose into a **verified** feasible point is the general OPT
— the SXE-21 engine tier's — and returns NOT_COMPUTED naming
the tier; contradictory envelopes likewise return
NOT_COMPUTED naming both citations. Neither case ships an
improvised number.

Outputs: `verdict` ("relaxed" / "feasible-as-requested"), the
`claim` wording, the `requested` point with resolved
priorities, the `realistic` point, the `changes` diff (from /
to / relative change / forcing envelopes / priority /
mustRelaxed), `alternatives` (each with its own full point,
diff, and max relative change), `maxRelativeChange`, and the
`envelope` block (the constraints as supplied, the L3 tier,
and the engine tier's NOT_COMPUTED status). Envelope status is
WARN on every run — the engine-tier notice rides as a warning,
and the JS result is never labelled as the engine result.

## Reference cases

Asserted in `server/tests/conkay-orc-realistic-fallback.test.js`
with expected values computed independently from the cited
bounds:

1. **"0–100 km/h in 0.5 s"** against the tyre-friction bound
   a ≤ μg (μ = 1.0 declared, g = 9.80665 m/s²). Requested
   acceleration 55.56 m/s². The balanced min-max relaxation
   (t = 0.6999290) gives 8.3353 m/s (30.007 km/h) in
   0.84996 s — exactly on the bound. Pareto alternatives:
   speed alone → 4.903325 m/s (μg × 0.5 s); time alone →
   2.832545 s (v / μg).
2. **"1 kg drone carrying 100 kg for 10 h"** against a
   mass-closure ratio (payload fraction ≤ 0.40 over declared
   structure/battery fractions) and an energy endurance limit
   (0.35 kg at the 300 Wh/kg ceiling = 105 Wh over cruise
   power 18.38746875 W at the requested 1 kg point →
   20557.4789 s). With totalMass ranked "must", the primary
   holds 1 kg and relaxes payload alone to 0.4 kg; without
   the ranking, the min-max balance leads (payload
   0.79681 kg, totalMass 1.99203 kg).

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.realistic-fallback",
  "inputs": { "requirements": [ { "metric": "speed", "bound": { "kind": "min", "si": 27.777777777777779, "unit": "m/s", "given": 100 }, "source": "0-100 km/h" },
                                { "metric": "time", "bound": { "kind": "max", "si": 0.5, "unit": "s" }, "source": "in 0.5 s" } ],
              "constraints": [ { "kind": "ratio", "numerator": "speed", "denominator": "time", "bound": { "kind": "max", "si": 9.80665, "unit": "m/s^2" },
                                 "envelope": { "solver": "orc.feasibility", "citation": "tyre-friction bound a <= mu*g with mu = 1.0 declared (high-grip tyre, dry asphalt) — Gillespie, Fundamentals of Vehicle Dynamics; g = 9.80665 m/s^2" } } ] } }
```

Expected envelope: status WARN (the SXE-21 engine-tier notice
rides as a warning on every run) with
`outputs.verdict == "relaxed"`, the realistic point sitting
exactly on the cited friction bound, every change citing the
feasibility envelope, inputs echoed exactly.

## Adversarial shape

- Missing/empty requirements → `NOT_COMPUTED
  missing_input:requirements`; a bound without its unit →
  refused naming the field (SC-04); NaN / 1e300 / non-positive
  bound values → `INVALID_INPUT` naming the field.
- A constraint without a solver citation → NOT_COMPUTED (an
  uncited constraint cannot force a change); a constraint over
  an undeclared metric → refused by name.
- Contradictory limit envelopes → `NOT_COMPUTED
  contradictory_envelopes` naming both citations.
- A ratio boxed in by limits on every side → `NOT_COMPUTED
  engine_tier_required:sxe-21`; the general OPT is never
  approximated at the JS tier.
