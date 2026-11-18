# orc.chain-run — the system chain runner

Solver id: `orc.chain-run` · v1.0.0 · domain: orchestration · fidelity L1
Source: `server/lib/conkay/orc/chain-run.js`
Chain definition: `docs/conkay/chains/system-chain.md` · Receipt: `docs/conkay/chains/chain-receipt.md`

## What it does

Executes the system chain over the landed wave-0 solvers as one
run with named output→input mappings, and assembles the
**chain-level receipt** (SX-CHAIN-RECEIPT) over the run: one
signed artifact hashing every link, with the seam contracts
inside it.

Steps: intent → requirements → architecture → per-part CAD
(geometry + materials) → mass/BOM (its `budgetKg` input is
**mapped from the requirements link's mass bound**) →
integration checks → research gaps (optional) → iterate
(optional) → **fallback (declared, never runs — SX-ORC-09 is
BLOCKED on F10; recorded SKIPPED with F10 named in every
receipt)** → system report (consuming the architecture,
mass-bom, BOM, integration, and gaps links' outputs).

A link returning NOT_COMPUTED **stops the chain**: the receipt
stands INCOMPLETE naming step + reason, later links never run.
Seams evaluated over the links that ran: mass-budget,
part-mass-agreement, mass-total-agreement,
integration-verdict-carried (definitions in the chain doc). The
receipt signs only when every link computed and every seam
holds.

Inputs (node props under the literal key `orc.chainRun`):
`{text, system: {id}, parts, bomItems, currency?, integration,
needs?, iterateProps?}`.

## Reference case

The golden robot chain (brief "a bipedal robot that weighs
20 kg, does 3 m/s"; two 1 kg cubes through CAD, mass-bom, and
the BOM tree; a closing power budget; one research gap) runs
all nine runnable links and signs: mass-budget seam holds at
2 kg ≤ 20 kg, both mass roll-ups agree, the report is COMPLETE.
Asserted in `server/tests/conkay-orc-chain-run.test.js`,
including the two failure edges: a BOM double-count producing
SEAM_VIOLATION with every link green, and an unknown material
stopping the chain at parts-cad.

## Replay request (SXC-23 form)

```json
{ "solver_id": "orc.chain-run",
  "inputs": { "text": "a bipedal robot that weighs 20 kg, does 3 m/s",
              "system": { "id": "chain-rig" },
              "parts": [ { "id": "block-a", "massProperties": { "shape": "box", "dims": { "length": 0.1, "width": 0.1, "height": 0.1 }, "densityKgM3": 1000 }, "position": [0, 0, 0.05] } ],
              "bomItems": [ { "id": "block-a", "qty": 1, "massProperties": { "shape": "box", "dims": { "length": 0.1, "width": 0.1, "height": 0.1 }, "densityKgM3": 1000 }, "unitCost": 10 } ],
              "integration": { "power": { "suppliedW": 100, "consumedW": 90, "lossesW": 10 } } } }
```

Expected envelope: status PASS with
`outputs.chainReceipt.status == "SIGNED"` (the single-part
variant of the golden chain), the fallback step present in
`outputs.chainReceipt.skipped` with F10 named, inputs echoed
exactly.

## Adversarial shape

- Missing text / system.id / parts / bomItems / integration →
  `NOT_COMPUTED missing_input` naming the field.
- A link's NOT_COMPUTED (unknown material, unparseable brief)
  → the chain stops; the receipt names the step and reason.
- Any seam disagreement → SEAM_VIOLATION; the run still returns
  the full receipt so the disagreement is inspectable.
